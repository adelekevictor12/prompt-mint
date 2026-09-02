import Prompt from "../models/Prompt";
import User from "../models/User";
import {
  cacheGet,
  cacheSet,
  CACHE_KEYS,
  PROMPT_METADATA_TTL_SECONDS,
} from "./cacheService";

/**
 * Indexer-backed marketplace read model.
 *
 * The background event indexer (`services/indexer.ts`) keeps the `Prompt`
 * collection in sync with on-chain contract events. This service is the
 * external, read-optimized surface on top of that indexed data: it serves
 * search + pagination without ever touching the Stellar RPC, and it leans on
 * Redis cache-aside so high-volume browse traffic stays off the database.
 */

export type MarketplaceSort =
  | "newest"
  | "oldest"
  | "price_asc"
  | "price_desc"
  | "sales"
  | "rating"
  | "relevance";

export interface MarketplaceQuery {
  /** Free-text search across title, content, category, and tags. */
  search?: string;
  /** Exact category match (one of the Prompt categories). */
  category?: string;
  /** Match any of the supplied tags. */
  tags?: string[];
  /** Restrict to a creator's wallet address. */
  walletAddress?: string;
  minPrice?: number;
  maxPrice?: number;
  /** Only surface prompts that passed (or failed) plagiarism checks. */
  similarityFlag?: "clean" | "suspicious" | "highly_similar";
  sort?: MarketplaceSort;
  /** 1-based page number. Ignored when `cursor` is supplied. */
  page?: number;
  /** Page size. Clamped to a safe maximum for high-volume reads. */
  limit?: number;
  /**
   * Opaque keyset cursor for scale-out pagination. When present it takes
   * precedence over `page` and avoids the deep-offset scans that wreck
   * performance on large collections.
   */
  cursor?: string;
}

export interface MarketplacePage {
  items: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Opaque cursor for fetching the next page, or null when exhausted. */
  nextCursor: string | null;
  hasNext: boolean;
  /** Whether the response was served from the Redis cache. */
  cached: boolean;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const SORT_SPECS: Record<
  MarketplaceSort,
  { order: 1 | -1; field: string; tiebreak: 1 | -1 }
> = {
  newest: { field: "createdAt", order: -1, tiebreak: -1 },
  oldest: { field: "createdAt", order: 1, tiebreak: 1 },
  price_asc: { field: "price", order: 1, tiebreak: 1 },
  price_desc: { field: "price", order: -1, tiebreak: -1 },
  sales: { field: "salesCount", order: -1, tiebreak: -1 },
  rating: { field: "rating", order: -1, tiebreak: -1 },
  relevance: { field: "score", order: -1, tiebreak: -1 },
};

interface NormalizedQuery {
  search?: string;
  category?: string;
  tags: string[];
  ownerId?: string;
  minPrice?: number;
  maxPrice?: number;
  similarityFlag?: string;
  sort: MarketplaceSort;
  limit: number;
  cursor?: string;
}

function normalizeQuery(q: MarketplaceQuery): NormalizedQuery {
  const limit = Math.min(
    Math.max(1, Math.floor(q.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );
  const tags = Array.isArray(q.tags)
    ? Array.from(new Set(q.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean)))
    : [];
  const sort: MarketplaceSort =
    q.sort === "relevance" && !q.search ? "newest" : (q.sort ?? (q.search ? "relevance" : "newest"));

  return {
    search: q.search?.trim() || undefined,
    category: q.category?.trim() || undefined,
    tags,
    ownerId: undefined,
    minPrice: q.minPrice,
    maxPrice: q.maxPrice,
    similarityFlag: q.similarityFlag,
    sort,
    limit,
    cursor: q.cursor,
  };
}

function buildFilter(q: NormalizedQuery): Record<string, any> {
  const filter: Record<string, any> = { listingStatus: "published", isActive: true };

  if (q.category) filter.category = q.category;
  if (q.tags.length) filter.tags = { $in: q.tags };
  if (q.ownerId) filter.owner = q.ownerId;
  if (q.similarityFlag) filter.similarityFlag = q.similarityFlag;

  if (q.minPrice != null || q.maxPrice != null) {
    filter.price = {};
    if (q.minPrice != null) filter.price.$gte = q.minPrice;
    if (q.maxPrice != null) filter.price.$lte = q.maxPrice;
  }

  if (q.search) {
    // `$text` requires the text index defined on the Prompt model. When search
    // is present we also project a `score` used for relevance sorting.
    filter.$text = { $search: q.search };
  }

  return filter;
}

function sortSpec(q: NormalizedQuery) {
  return SORT_SPECS[q.sort];
}

function selectCursor(spec: { field: string; order: 1 | -1; tiebreak: 1 | -1 }, doc: any) {
  return Buffer.from(
    JSON.stringify({ v: doc[spec.field], _id: String(doc._id) }),
  ).toString("base64url");
}

function decodeCursor(cursor: string, spec: { field: string; order: 1 | -1; tiebreak: 1 | -1 }) {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { v: any; _id: string };
    if (typeof parsed.v === "undefined" || typeof parsed._id !== "string") return null;

    const field = spec.field;
    const dir = spec.order;
    // Keyset condition: `<` for descending, `>` for ascending, with `_id`
    // tiebreaker so pagination is stable across duplicate sort values.
    const rangeOp = dir === -1 ? "$lt" : "$gt";
    return {
      $or: [
        { [field]: { [rangeOp]: parsed.v } },
        { [field]: parsed.v, _id: { [rangeOp]: parsed._id } },
      ],
    };
  } catch {
    return null;
  }
}

function cacheKeyFor(q: NormalizedQuery): string {
  const payload = {
    s: q.search ?? "",
    c: q.category ?? "",
    t: [...q.tags].sort(),
    o: q.ownerId ?? "",
    min: q.minPrice ?? "",
    max: q.maxPrice ?? "",
    sim: q.similarityFlag ?? "",
    sort: q.sort,
    lim: q.limit,
    cur: q.cursor ?? "",
  };
  return CACHE_KEYS.promptList(JSON.stringify(payload));
}

/**
 * Resolve a wallet address to its internal user id. The indexer stores the
 * creator reference as an ObjectId, so we map the wallet before querying.
 */
async function resolveOwnerId(walletAddress?: string): Promise<string | undefined> {
  if (!walletAddress) return undefined;
  const user = await User.findOne({ walletAddress: walletAddress.toLowerCase() }).select("_id");
  return user?._id ? String(user._id) : undefined;
}

/**
 * Query the indexed marketplace with search, filtering, sorting, and
 * pagination. Results are cached-aside in Redis keyed by the normalized
 * query (including cursor), so repeated browse traffic never reaches Mongo.
 */
export async function searchMarketplace(raw: MarketplaceQuery): Promise<MarketplacePage> {
  const q = normalizeQuery(raw);
  q.ownerId = await resolveOwnerId(raw.walletAddress);

  const cacheKey = cacheKeyFor(q);
  const cached = await cacheGet(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached) as MarketplacePage;
    parsed.cached = true;
    return parsed;
  }

  const filter = buildFilter(q);
  const spec = sortSpec(q);

  // Keyset (cursor) pagination kicks in when a cursor is supplied; otherwise we
  // fall back to offset pagination keyed by `page`.
  const cursorFilter = q.cursor ? decodeCursor(q.cursor, spec) : null;
  const page = Math.max(1, Math.floor(raw.page ?? 1) || 1);
  const skip = cursorFilter ? 0 : (page - 1) * q.limit;

  const query = Prompt.find({ ...filter, ...(cursorFilter ?? {}) });

  if (q.search) {
    query.select({ score: { $meta: "textScore" } });
  }

  const items = await query
    .populate("owner", "username walletAddress")
    .sort({ [spec.field]: spec.order, _id: spec.tiebreak })
    .skip(skip)
    .limit(q.limit + 1) // fetch one extra to detect "has next"
    .lean();

  const hasNext = items.length > q.limit;
  const pageItems = hasNext ? items.slice(0, q.limit) : items;

  const total = await Prompt.countDocuments(filter);

  const nextCursor =
    hasNext && pageItems.length
      ? selectCursor(spec, pageItems[pageItems.length - 1])
      : null;

  const result: MarketplacePage = {
    items: pageItems,
    total,
    page: cursorFilter ? 0 : page,
    limit: q.limit,
    totalPages: Math.ceil(total / q.limit),
    nextCursor,
    hasNext,
    cached: false,
  };

  // Cache the page (TTL handled by cacheService default). The list key lives
  // under the `prompts:list:*` namespace which `invalidatePromptMetadata`
  // wipes whenever an indexed contract event mutates a prompt.
  await cacheSet(cacheKey, JSON.stringify(result), PROMPT_METADATA_TTL_SECONDS);

  return result;
}

/**
 * Build a cursor-only page from raw request query parameters. Convenience used
 * by controllers so they don't have to know the NormalizedQuery shape.
 */
export function parseMarketplaceQuery(params: URLSearchParams): MarketplaceQuery {
  const tags = params.get("tags");
  const minPrice = params.get("minPrice");
  const maxPrice = params.get("maxPrice");

  return {
    search: params.get("search") ?? undefined,
    category: params.get("category") ?? undefined,
    tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    walletAddress: params.get("walletAddress") ?? undefined,
    minPrice: minPrice != null && minPrice !== "" ? Number(minPrice) : undefined,
    maxPrice: maxPrice != null && maxPrice !== "" ? Number(maxPrice) : undefined,
    similarityFlag: (params.get("similarityFlag") as MarketplaceQuery["similarityFlag"]) ?? undefined,
    sort: (params.get("sort") as MarketplaceSort) ?? undefined,
    page: params.get("page") ? Number(params.get("page")) : undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    cursor: params.get("cursor") ?? undefined,
  };
}

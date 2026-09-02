import { searchMarketplace, parseMarketplaceQuery } from "../services/marketplaceIndexService";
import Prompt from "../models/Prompt";
import User from "../models/User";
import { cacheGet, cacheSet } from "../services/cacheService";

jest.mock("../models/Prompt");
jest.mock("../models/User");
jest.mock("../services/cacheService", () => {
  // Keep the real cache-key builder/constants; only stub the I/O functions.
  const actual = jest.requireActual("../services/cacheService");
  return {
    ...actual,
    cacheGet: jest.fn(),
    cacheSet: jest.fn(),
  };
});
jest.mock("../db/connectDb", () => jest.fn().mockResolvedValue(true));

let resolvedUser: any = null;

function makeChain(items: any[]) {
  const chain: any = {
    project: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  };
  return chain;
}

const mockFind = Prompt.find as jest.Mock;
const mockCount = Prompt.countDocuments as jest.Mock;
const mockUserFindOne = User.findOne as jest.Mock;
const mockCacheGet = cacheGet as jest.Mock;
const mockCacheSet = cacheSet as jest.Mock;

describe("searchMarketplace (indexer-backed read model)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    resolvedUser = null;
    mockUserFindOne.mockImplementation(() => ({ select: jest.fn().mockResolvedValue(resolvedUser) }));
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    mockCount.mockResolvedValue(40);
  });

  it("serves a cached page without querying the database", async () => {
    const cachedPage = { items: [{ _id: "x" }], total: 1, cached: false };
    mockCacheGet.mockResolvedValue(JSON.stringify(cachedPage));

    const result = await searchMarketplace({ page: 1, limit: 10 });

    expect(result.cached).toBe(true);
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it("applies the published/active base filter plus category, tags, and price", async () => {
    makeChainReturns([seedPrompt("p1"), seedPrompt("p2")]);
    resolvedUser = { _id: "owner1" };

    await searchMarketplace({
      category: "Programming",
      tags: ["ai", "ai"],
      walletAddress: "GABC",
      minPrice: 1,
      maxPrice: 50,
    });

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        listingStatus: "published",
        isActive: true,
        category: "Programming",
        tags: { $in: ["ai"] },
        owner: "owner1",
        price: { $gte: 1, $lte: 50 },
      }),
    );
  });

  it("uses a $text filter and relevance sort when searching", async () => {
    makeChainReturns([seedPrompt("p1")]);

    await searchMarketplace({ search: "draught" });

    const filter = mockFind.mock.calls[0][0];
    expect(filter.$text).toEqual({ $search: "draught" });
  });

  it("detects a next page and emits an opaque cursor when the page overflows", async () => {
    const overflow = Array.from({ length: 11 }, (_, i) => seedPrompt(`p${i}`, i));
    makeChainReturns(overflow);

    const result = await searchMarketplace({ limit: 10, sort: "newest" });

    expect(result.hasNext).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.items).toHaveLength(10);
    // Keyset cursor decodes to the last item's tiebreaker + sort value.
    const decoded = JSON.parse(
      Buffer.from(result.nextCursor as string, "base64url").toString("utf8"),
    );
    expect(decoded._id).toBe("p9");
  });

  it("rewrites the DB filter with a keyset condition when a cursor is supplied", async () => {
    const cursor = Buffer.from(JSON.stringify({ v: 123, _id: "p9" })).toString("base64url");
    makeChainReturns([seedPrompt("p0")]);

    await searchMarketplace({ cursor, sort: "price_asc", limit: 10 });

    const filter = mockFind.mock.calls[0][0];
    expect(filter.$or).toBeDefined();
    expect(filter.$or[0]).toEqual({ price: { $gt: 123 } });
  });

  it("clamps oversized limit to the maximum page size", async () => {
    makeChainReturns([seedPrompt("p1")]);

    await searchMarketplace({ limit: 5000 });

    const chain = mockFind.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(100 + 1);
  });

  it("caches the computed page under the list namespace", async () => {
    makeChainReturns([seedPrompt("p1")]);

    await searchMarketplace({ page: 2, limit: 12 });

    expect(mockCacheSet).toHaveBeenCalledTimes(1);
    const key = mockCacheSet.mock.calls[0][0];
    expect(key.startsWith("prompts:list:")).toBe(true);
  });

  function makeChainReturns(items: any[]) {
    mockFind.mockReturnValue(makeChain(items));
  }
});

function seedPrompt(id: string, sales = 0) {
  return { _id: id, title: `Prompt ${id}`, salesCount: sales, price: 5, createdAt: new Date() };
}

describe("parseMarketplaceQuery", () => {
  it("parses comma tags, numeric bounds, and pagination params", () => {
    const params = new URLSearchParams(
      "tags=a,b&minPrice=1&maxPrice=9&page=3&limit=5&sort=price_asc&search=foo",
    );
    const q = parseMarketplaceQuery(params);
    expect(q.tags).toEqual(["a", "b"]);
    expect(q.minPrice).toBe(1);
    expect(q.maxPrice).toBe(9);
    expect(q.page).toBe(3);
    expect(q.limit).toBe(5);
    expect(q.sort).toBe("price_asc");
    expect(q.search).toBe("foo");
  });
});

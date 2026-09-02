import type { PromptRecord } from "./promptHashClient";

export interface MarketplaceReadCacheEntry {
  timestamp: number;
  prompts: PromptRecord[];
}

export interface MarketplaceReadCacheState {
  hasCache: boolean;
  isFresh: boolean;
  isStale: boolean;
  canServeStaleContent: boolean;
  useStaleWhileRevalidating: boolean;
  prompts: PromptRecord[] | null;
  ageMs: number | null;
}

export const MARKETPLACE_CACHE_STORAGE_KEY = "prompt-mint:marketplace-prompts-cache";
export const DEFAULT_MARKETPLACE_STALE_TIME_MS = 60_000;
export const DEFAULT_MARKETPLACE_MAX_STALE_AGE_MS = 5 * 60_000;

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function readMarketplaceReadCache(
  storage: Storage | null | undefined = getStorage(),
): MarketplaceReadCacheEntry | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(MARKETPLACE_CACHE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<MarketplaceReadCacheEntry>;
    if (!parsed?.timestamp || !Array.isArray(parsed.prompts)) {
      return null;
    }

    return {
      timestamp: parsed.timestamp,
      prompts: parsed.prompts as PromptRecord[],
    };
  } catch {
    return null;
  }
}

export function writeMarketplaceReadCache(
  prompts: PromptRecord[],
  storage: Storage | null | undefined = getStorage(),
) {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      MARKETPLACE_CACHE_STORAGE_KEY,
      JSON.stringify(
        {
          timestamp: Date.now(),
          prompts,
        } satisfies MarketplaceReadCacheEntry,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    );
  } catch {
    // Ignore storage write failures so the marketplace read can continue.
  }
}

export function getMarketplaceReadCacheState(
  entry: MarketplaceReadCacheEntry | null | undefined,
  now = Date.now(),
  staleAfterMs = DEFAULT_MARKETPLACE_STALE_TIME_MS,
  maxStaleAgeMs = DEFAULT_MARKETPLACE_MAX_STALE_AGE_MS,
): MarketplaceReadCacheState {
  if (!entry?.prompts?.length) {
    return {
      hasCache: false,
      isFresh: false,
      isStale: false,
      canServeStaleContent: false,
      useStaleWhileRevalidating: false,
      prompts: null,
      ageMs: null,
    };
  }

  const ageMs = now - entry.timestamp;
  const isFresh = ageMs <= staleAfterMs;
  const isStale = ageMs > staleAfterMs;
  const canServeStaleContent = ageMs <= maxStaleAgeMs;

  return {
    hasCache: true,
    isFresh,
    isStale,
    canServeStaleContent,
    useStaleWhileRevalidating: isStale && canServeStaleContent,
    prompts: canServeStaleContent ? entry.prompts : null,
    ageMs,
  };
}

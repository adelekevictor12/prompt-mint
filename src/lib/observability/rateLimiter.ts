import { LRUCache } from "lru-cache";
import { getRedisClient } from "./redisClient";

interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export type UserTier = "free" | "verified" | "premium";
export type RateLimitType = "challenge" | "unlock" | "bundle_unlock" | "analytics";

const ONE_HOUR_MS = 60 * 60 * 1000;

// Unauthenticated (no wallet address provided) requests get stricter limits.
const limits: Record<RateLimitType, { authenticated: RateLimitConfig; unauthenticated: RateLimitConfig }> = {
  challenge: {
    unauthenticated: { max: 10, windowMs: 60_000 },
    authenticated: { max: 15, windowMs: 60_000 },
  },
  unlock: {
    unauthenticated: { max: 3, windowMs: 60_000 },
    authenticated: { max: 5, windowMs: 60_000 },
  },
  bundle_unlock: {
    unauthenticated: { max: 3, windowMs: 60_000 },
    authenticated: { max: 5, windowMs: 60_000 },
  },
  // Analytics events are high-volume and low-risk compared to unlock/challenge,
  // so the limits are looser — this guards against a runaway client loop, not
  // normal browsing traffic.
  analytics: {
    unauthenticated: { max: 60, windowMs: 60_000 },
    authenticated: { max: 120, windowMs: 60_000 },
  },
};

// Tiered unlock limits per hour (#208): free=10/hr, verified=100/hr, premium=1000/hr
const unlockTierLimits: Record<UserTier, RateLimitConfig> = {
  free: { max: 10, windowMs: ONE_HOUR_MS },
  verified: { max: 100, windowMs: ONE_HOUR_MS },
  premium: { max: 1000, windowMs: ONE_HOUR_MS },
};

// In-memory LRU fallback used when Redis is unavailable.
const fallbackCaches = new Map<string, LRUCache<string, number>>();

function getFallbackCache(key: string, config: RateLimitConfig) {
  if (!fallbackCaches.has(key)) {
    fallbackCaches.set(key, new LRUCache<string, number>({ max: 1000, ttl: config.windowMs }));
  }
  return fallbackCaches.get(key)!;
}

function inMemoryCheck(
  bucketKey: string,
  config: RateLimitConfig,
): { success: boolean; limit: number; remaining: number; reset: number } {
  const cache = getFallbackCache(bucketKey, config);
  const current = cache.get(bucketKey) ?? 0;
  const remaining = Math.max(0, config.max - (current + 1));
  if (current >= config.max) {
    return { success: false, limit: config.max, remaining: 0, reset: config.windowMs };
  }
  cache.set(bucketKey, current + 1);
  return { success: true, limit: config.max, remaining, reset: config.windowMs };
}

async function redisCheck(
  redis: Awaited<ReturnType<typeof getRedisClient>>,
  bucketKey: string,
  config: RateLimitConfig,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const key = `rl:${bucketKey}`;
  const windowSec = Math.ceil(config.windowMs / 1000);

  const multi = redis!.multi();
  multi.incr(key);
  multi.expire(key, windowSec, "NX");
  const [count] = (await multi.exec()) as [number, ...unknown[]];

  const ttlSec = await redis!.ttl(key);
  const reset = ttlSec > 0 ? ttlSec * 1000 : config.windowMs;

  if (count > config.max) {
    return { success: false, limit: config.max, remaining: 0, reset };
  }
  return { success: true, limit: config.max, remaining: Math.max(0, config.max - count), reset };
}

export async function checkRateLimit(
  type: RateLimitType,
  identifier: string,
  authenticated = false,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const config = limits[type]?.[authenticated ? "authenticated" : "unauthenticated"] ?? {
    max: 10,
    windowMs: 60_000,
  };
  const bucketKey = `${type}:${identifier}`;

  try {
    const redis = await getRedisClient();
    if (redis) return await redisCheck(redis, bucketKey, config);
  } catch {
    // Redis unavailable — fall back to in-memory.
  }

  return inMemoryCheck(bucketKey, config);
}

/**
 * Dedicated rate limit check keyed by wallet address (#449).
 */
export async function checkWalletRateLimit(
  type: RateLimitType,
  walletAddress: string,
  authenticated = true,
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  return checkRateLimit(type, `wallet:${walletAddress}`, authenticated);
}

/**
 * Dual rate limit checker evaluating both IP-based and wallet-based limits (#449).
 */
export async function checkDualRateLimit(
  type: RateLimitType,
  opts: { ip: string; wallet?: string | null; authenticated?: boolean },
): Promise<{
  success: boolean;
  blockedBy?: "ip" | "wallet";
  limit: number;
  remaining: number;
  reset: number;
}> {
  // 1. Check IP rate limit first
  const ipResult = await checkRateLimit(type, `ip:${opts.ip}`, Boolean(opts.authenticated));
  if (!ipResult.success) {
    return {
      success: false,
      blockedBy: "ip",
      limit: ipResult.limit,
      remaining: ipResult.remaining,
      reset: ipResult.reset,
    };
  }

  // 2. Check wallet rate limit if wallet address is supplied
  if (opts.wallet) {
    const walletResult = await checkWalletRateLimit(type, opts.wallet, true);
    if (!walletResult.success) {
      return {
        success: false,
        blockedBy: "wallet",
        limit: walletResult.limit,
        remaining: walletResult.remaining,
        reset: walletResult.reset,
      };
    }
    return {
      success: true,
      limit: Math.min(ipResult.limit, walletResult.limit),
      remaining: Math.min(ipResult.remaining, walletResult.remaining),
      reset: Math.max(ipResult.reset, walletResult.reset),
    };
  }

  return {
    success: true,
    limit: ipResult.limit,
    remaining: ipResult.remaining,
    reset: ipResult.reset,
  };
}

/**
 * Tiered rate limit check for unlock requests (#208).
 * Resolves the caller's wallet tier and applies the corresponding hourly quota.
 */
export async function checkUnlockTierLimit(
  identifier: string,
  tier: UserTier = "free",
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const config = unlockTierLimits[tier];
  const bucketKey = `unlock_tier:${tier}:${identifier}`;

  try {
    const redis = await getRedisClient();
    if (redis) return await redisCheck(redis, bucketKey, config);
  } catch {
    // Redis unavailable — fall back to in-memory.
  }

  return inMemoryCheck(bucketKey, config);
}

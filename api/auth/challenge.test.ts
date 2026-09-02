// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { ErrorCode } from "../../src/lib/api/errorCodes";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import {
  isAccountLocked,
  isCaptchaRequired,
  verifyCaptchaToken,
  recordFailedAuthAttempt,
  resetAbuseProtectionState,
} from "../../src/lib/auth/abuseProtection";

vi.mock("../../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../../src/lib/observability/rateLimiter", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("../../src/lib/observability/redisClient", () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/lib/observability/metrics", () => ({
  metrics: {
    trackChallengeIssued: vi.fn(),
    trackRateLimitHit: vi.fn(),
  },
}));

vi.mock("../../server/src/services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
}));

import handler from "./challenge";

function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers,
    body,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    requestId: "test-request",
    socket: { remoteAddress: "127.0.0.1" },
  };
}

async function invoke(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};
  const setHeaders: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: Record<string, unknown>) {
      responseData = data;
      return this;
    },
    setHeader: vi.fn((key: string, val: unknown) => {
      setHeaders[key] = val;
    }),
  };

  process.env.CHALLENGE_TOKEN_SECRET = "integration-test-challenge-secret";

  // @ts-expect-error test handler invocation
  await handler(makeReq(body, headers), res);
  return { statusCode, responseData, setHeaders };
}

describe("challenge API rate limiting and abuse prevention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAbuseProtectionState();
    vi.mocked(checkRateLimit).mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: 60_000,
    });
  });

  it("issues a token for a valid request body", async () => {
    const buyer = Keypair.random();
    const { statusCode, responseData } = await invoke({
      address: buyer.publicKey(),
      promptId: "99",
    });

    expect(statusCode).toBe(200);
    expect(responseData.token).toBeTruthy();
    expect(responseData.challenge).toContain("prompt-hash unlock:");
  });

  it("returns MISSING_FIELDS for malformed bodies", async () => {
    const { statusCode, responseData } = await invoke({ promptId: "not-a-number" });

    expect(statusCode).toBe(400);
    expect(responseData.code).toBe(ErrorCode.MISSING_FIELDS);
  });

  it("returns same error shape for invalid Stellar address (no enumeration via timing)", async () => {
    const { statusCode: s1, responseData: r1 } = await invoke({
      address: "GBADINVALIDKEY1234567890ABCDEFGH1234567890ABCDEFGH12345",
      promptId: "1",
    });
    const { statusCode: s2, responseData: r2 } = await invoke({
      address: "not-a-key",
      promptId: "1",
    });
    expect(s1).toBe(400);
    expect(s2).toBe(400);
    expect(r1.code).toBe(ErrorCode.MISSING_FIELDS);
    expect(r2.code).toBe(ErrorCode.MISSING_FIELDS);
    // Both responses must not leak whether address format or promptId was wrong
    expect(r1.code).toBe(r2.code);
  });

  it("enforces rate limit of 10 requests per IP per minute (HTTP 429)", async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      success: false,
      limit: 10,
      remaining: 0,
      reset: 60_000,
    });

    const buyer = Keypair.random();
    const { statusCode, responseData, setHeaders } = await invoke({
      address: buyer.publicKey(),
      promptId: "99",
    });

    expect(statusCode).toBe(429);
    expect(responseData.code).toBe(ErrorCode.RATE_LIMIT_IP);
    expect(setHeaders["X-RateLimit-Limit"]).toBe(10);
    expect(setHeaders["X-RateLimit-Remaining"]).toBe(0);
  });

  it("enforces rate limit per wallet address (HTTP 429 RATE_LIMIT_WALLET)", async () => {
    // First call (IP) passes, second call (wallet) fails
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({
        success: true,
        limit: 10,
        remaining: 9,
        reset: 60_000,
      })
      .mockResolvedValueOnce({
        success: false,
        limit: 15,
        remaining: 0,
        reset: 60_000,
      });

    const buyer = Keypair.random();
    const { statusCode, responseData, setHeaders } = await invoke({
      address: buyer.publicKey(),
      promptId: "99",
    });

    expect(statusCode).toBe(429);
    expect(responseData.code).toBe(ErrorCode.RATE_LIMIT_WALLET);
    expect(setHeaders["X-RateLimit-Limit"]).toBe(15);
    expect(setHeaders["X-RateLimit-Remaining"]).toBe(0);
  });


  it("rejects challenge generation if the wallet account is locked (HTTP 423)", async () => {
    const buyer = Keypair.random();
    const address = buyer.publicKey();

    // Trigger 5 failed attempts to lock the account
    for (let i = 0; i < 5; i++) {
      await recordFailedAuthAttempt(address);
    }

    const { statusCode, responseData } = await invoke({
      address,
      promptId: "99",
    });

    expect(statusCode).toBe(423);
    expect(responseData.code).toBe(ErrorCode.ACCOUNT_LOCKED);
    expect(responseData.error).toContain("Account is locked");
  });

  it("requires CAPTCHA when repeated failures have occurred (HTTP 403)", async () => {
    const buyer = Keypair.random();
    const address = buyer.publicKey();

    // Trigger 3 failures to meet CAPTCHA threshold
    for (let i = 0; i < 3; i++) {
      await recordFailedAuthAttempt(address, "127.0.0.1");
    }

    // Request without CAPTCHA token
    const { statusCode, responseData } = await invoke({
      address,
      promptId: "99",
    });

    expect(statusCode).toBe(403);
    expect(responseData.code).toBe(ErrorCode.CAPTCHA_REQUIRED);
    expect(responseData.captchaRequired).toBe(true);
  });

  it("rejects invalid CAPTCHA token when CAPTCHA is required (HTTP 403)", async () => {
    const buyer = Keypair.random();
    const address = buyer.publicKey();

    for (let i = 0; i < 3; i++) {
      await recordFailedAuthAttempt(address, "127.0.0.1");
    }

    const { statusCode, responseData } = await invoke({
      address,
      promptId: "99",
      captchaToken: "invalid",
    });

    expect(statusCode).toBe(403);
    expect(responseData.code).toBe(ErrorCode.CAPTCHA_INVALID);
  });

  it("allows challenge issuance when valid CAPTCHA token is provided", async () => {
    const buyer = Keypair.random();
    const address = buyer.publicKey();

    for (let i = 0; i < 3; i++) {
      await recordFailedAuthAttempt(address, "127.0.0.1");
    }

    const { statusCode, responseData } = await invoke({
      address,
      promptId: "99",
      captchaToken: "test-captcha-token-valid",
    });

    expect(statusCode).toBe(200);
    expect(responseData.token).toBeTruthy();
  });
});

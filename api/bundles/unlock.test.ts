// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createChallengeToken } from "../../src/lib/auth/challenge";
import { ErrorCode } from "../../src/lib/api/errorCodes";
import { resetAbuseProtectionState, recordFailedAuthAttempt } from "../../src/lib/auth/abuseProtection";

const hasBundleAccessMock = vi.fn();
const getBundleMock = vi.fn();
const getPromptMock = vi.fn();
const unwrapPromptKeyMock = vi.fn();
const decryptPromptCiphertextMock = vi.fn();
const hashPromptPlaintextMock = vi.fn();

vi.mock("../../src/lib/stellar/promptHashClient", () => ({
  hasBundleAccess: (...args: unknown[]) => hasBundleAccessMock(...args),
  getBundle: (...args: unknown[]) => getBundleMock(...args),
  getPrompt: (...args: unknown[]) => getPromptMock(...args),
}));

vi.mock("../../src/lib/crypto/promptCrypto", () => ({
  unwrapPromptKey: (...args: unknown[]) => unwrapPromptKeyMock(...args),
  decryptPromptCiphertext: (...args: unknown[]) => decryptPromptCiphertextMock(...args),
  hashPromptPlaintext: (...args: unknown[]) => hashPromptPlaintextMock(...args),
  normalizeContentHash: (hash: string) => (hash ? hash.toLowerCase().trim() : ""),
}));

vi.mock("../../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../../src/lib/observability/rateLimiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: 60_000,
  }),
}));

vi.mock("../../src/lib/observability/replayProtection", () => ({
  checkReplayProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock("../../src/lib/observability/redisClient", () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/lib/observability/metrics", () => ({
  metrics: {
    trackUnlockSuccess: vi.fn(),
    trackUnlockFailure: vi.fn(),
    trackRateLimitHit: vi.fn(),
  },
}));

vi.mock("../../server/src/services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
}));

vi.mock("../../server/src/services/webhookDispatcher", () => ({
  dispatchEvent: vi.fn().mockResolvedValue(undefined),
}));

import handler from "./unlock";

async function setupBundleUnlockFixture() {
  const buyer = Keypair.random();
  const contentHash = "a".repeat(64);

  process.env.CHALLENGE_TOKEN_SECRET = "integration-test-challenge-secret";
  process.env.UNLOCK_PUBLIC_KEY = "d".repeat(32);
  process.env.UNLOCK_PRIVATE_KEY = "e".repeat(32);
  process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID =
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  process.env.PUBLIC_STELLAR_RPC_URL = "https://soroban-testnet.stellar.org";

  const bundleId = "10";
  const challenge = createChallengeToken(
    process.env.CHALLENGE_TOKEN_SECRET,
    buyer.publicKey(),
    bundleId,
  );
  const signedMessage = Buffer.from(
    buyer.sign(Buffer.from(challenge.challenge, "utf8")),
  ).toString("base64");

  hasBundleAccessMock.mockResolvedValue(true);
  getBundleMock.mockResolvedValue({
    id: 10n,
    creator: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
    title: "Test Bundle",
    promptIds: [1n, 2n],
  });
  getPromptMock.mockImplementation(async (_config: unknown, id: bigint) => ({
    id,
    creator: "GCREATORACCOUNT1234567890ABCDEFGH1234567890ABCDEFGH1234567890",
    title: `Prompt #${id}`,
    encryptedPrompt: "mockCiphertext",
    encryptionIv: "mockIv",
    wrappedKey: "mockWrappedKey",
    contentHash,
  }));

  unwrapPromptKeyMock.mockResolvedValue(new Uint8Array(32));
  decryptPromptCiphertextMock.mockResolvedValue("Decrypted prompt text");
  hashPromptPlaintextMock.mockResolvedValue(contentHash);

  return { buyer, bundleId, challenge, signedMessage, contentHash };
}

async function invokeBundleUnlock(body: Record<string, unknown>) {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};

  const req = {
    method: "POST",
    headers: {},
    body,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    requestId: "test-request",
    socket: { remoteAddress: "127.0.0.1" },
  };

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: Record<string, unknown>) {
      responseData = data;
      return this;
    },
    setHeader: vi.fn(),
  };

  // @ts-expect-error test handler invocation
  await handler(req, res);

  return { statusCode, responseData };
}

describe("bundle unlock API abuse protection & lockout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAbuseProtectionState();
  });

  it("unlocks all prompts in bundle when signature and access are valid", async () => {
    const { buyer, bundleId, challenge, signedMessage } =
      await setupBundleUnlockFixture();

    const { statusCode, responseData } = await invokeBundleUnlock({
      token: challenge.token,
      bundleId,
      address: buyer.publicKey(),
      signedMessage,
    });

    expect(statusCode).toBe(200);
    expect(responseData.bundleId).toBe("10");
    expect(Array.isArray(responseData.items)).toBe(true);
  });

  it("locks account after 5 failed authentication attempts on bundle unlock", async () => {
    const { buyer, bundleId, challenge } = await setupBundleUnlockFixture();
    const wrongSigner = Keypair.random();
    const wrongSignature = Buffer.from(
      wrongSigner.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    // Seed 5 failures directly so the account is locked (threshold is 5)
    for (let i = 0; i < 5; i++) {
      await recordFailedAuthAttempt(buyer.publicKey(), "127.0.0.1");
    }

    // Next attempt: account is locked
    const { statusCode, responseData } = await invokeBundleUnlock({
      token: challenge.token,
      bundleId,
      address: buyer.publicKey(),
      signedMessage: wrongSignature,
    });

    expect(statusCode).toBe(423);
    expect(responseData.code).toBe(ErrorCode.ACCOUNT_LOCKED);
  });

  it("requires and validates CAPTCHA for bundle unlock after repeated failures", async () => {
    const { buyer, bundleId, challenge } = await setupBundleUnlockFixture();
    const wrongSigner = Keypair.random();
    const wrongSignature = Buffer.from(
      wrongSigner.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    for (let i = 0; i < 3; i++) {
      await invokeBundleUnlock({
        token: challenge.token,
        bundleId,
        address: buyer.publicKey(),
        signedMessage: wrongSignature,
      });
    }

    const validSignature = Buffer.from(
      buyer.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");

    // Missing CAPTCHA returns 403
    const missingCaptcha = await invokeBundleUnlock({
      token: challenge.token,
      bundleId,
      address: buyer.publicKey(),
      signedMessage: validSignature,
    });
    expect(missingCaptcha.statusCode).toBe(403);
    expect(missingCaptcha.responseData.code).toBe(ErrorCode.CAPTCHA_REQUIRED);

    // With valid CAPTCHA, unlock succeeds
    const withCaptcha = await invokeBundleUnlock({
      token: challenge.token,
      bundleId,
      address: buyer.publicKey(),
      signedMessage: validSignature,
      captchaToken: "test-captcha-token-valid",
    });
    expect(withCaptcha.statusCode).toBe(200);
  });
});

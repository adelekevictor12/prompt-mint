import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";

export const DEFAULT_TTL_MS = 5 * 60 * 1000;
export const MIN_TTL_MS = 5 * 1000; // 5 seconds
export const MAX_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns the environment-configured challenge token TTL in milliseconds.
 * Reads process.env.CHALLENGE_TTL_MS or process.env.CHALLENGE_TOKEN_TTL_MS.
 *
 * Security Tradeoffs (#453):
 * - Short TTL (e.g., 30s - 2m): Reduces replay attack window and token interception risk,
 *   but may cause failure if user takes long to approve wallet signature prompt.
 * - Long TTL (e.g., 5m - 15m): More resilient against network delays and user prompts,
 *   but increases vulnerability window if challenge tokens are captured in transit.
 */
export function getChallengeTtlMs(overrideMs?: number): number {
  if (typeof overrideMs === "number" && !isNaN(overrideMs)) {
    return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, overrideMs));
  }

  const envVal =
    process.env.CHALLENGE_TTL_MS ||
    process.env.CHALLENGE_TOKEN_TTL_MS ||
    process.env.NEXT_PUBLIC_CHALLENGE_TTL_MS;

  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, parsed));
    }
  }

  return DEFAULT_TTL_MS;
}

export interface ChallengePayload {
  address: string;
  promptId: string;
  nonce: string;
  expiresAt: number;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function signPayload(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function buildChallengeMessage(payload: ChallengePayload) {
  return `prompt-hash unlock:${payload.address}:${payload.promptId}:${payload.nonce}:${payload.expiresAt}`;
}

export function createChallengeToken(
  secret: string,
  address: string,
  promptId: string,
  now = Date.now(),
  ttlMs = getChallengeTtlMs(),
) {
  const payload: ChallengePayload = {
    address,
    promptId,
    nonce: randomUUID(),
    expiresAt: now + ttlMs,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(secret, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    challenge: buildChallengeMessage(payload),
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  };
}

export function verifyChallengeToken(
  secret: string | string[],
  token: string,
  address: string,
  promptId: string,
  now = Date.now(),
) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Malformed challenge token.");
  }

  // Support multiple secrets for rotation grace period
  const secrets = Array.isArray(secret) ? secret : [secret];
  let validSignature = false;

  for (const sec of secrets) {
    const expectedSignature = signPayload(sec, encodedPayload);
    const received = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    
    if (received.length === expected.length && timingSafeEqual(received, expected)) {
      validSignature = true;
      break;
    }
  }

  if (!validSignature) {
    throw new Error("Invalid challenge token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as ChallengePayload;
  if (payload.address !== address || payload.promptId !== promptId) {
    throw new Error("Challenge token does not match the requested prompt unlock.");
  }

  if (payload.expiresAt < now) {
    throw new Error("Challenge token has expired.");
  }

  return payload;
}

/**
 * Message signed by a moderator wallet to authenticate an admin/moderation
 * request. Scoping by `purpose` prevents a signature captured for one
 * moderation endpoint from being replayed against another; the timestamp lets
 * the server reject stale signatures.
 */
export function buildModeratorAuthMessage(address: string, purpose: string, timestamp: number): string {
  return `prompt-hash moderator:${address}:${purpose}:${timestamp}`;
}

export function verifyChallengeSignature(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(address);
    return keypair.verify(Buffer.from(message, "utf8"), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Message a reporter wallet signs when filing an abuse report. Scoping it to the
 * exact target (type + id) and a timestamp means a captured signature can't be
 * replayed to file a different report or after it expires.
 */
export function buildReportAuthMessage(
  address: string,
  targetType: string,
  targetId: string,
  timestamp: number,
): string {
  return `prompt-hash report:${address}:${targetType}:${targetId}:${timestamp}`;
}

/** Verifies that `signature` proves control of `address` for a specific report. */
export function verifyReportSignature(
  address: string,
  targetType: string,
  targetId: string,
  timestamp: number,
  signature: string,
): boolean {
  const message = buildReportAuthMessage(address, targetType, targetId, timestamp);
  return verifyChallengeSignature(address, message, signature);
}

const REPORT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validates a reporter-supplied signature and timestamp. Returns a normalized
 * error so endpoints can respond consistently.
 */
export function verifyReportAuth({
  address,
  targetType,
  targetId,
  timestamp,
  signature,
  now = Date.now(),
}: {
  address?: string;
  targetType?: string;
  targetId?: string;
  timestamp?: number;
  signature?: string;
  now?: number;
}): { ok: boolean; status: number; error?: string } {
  if (!address) {
    return { ok: false, status: 401, error: "Reporter wallet address is required" };
  }
  if (!targetType || !targetId) {
    return { ok: false, status: 400, error: "Report target is required" };
  }
  if (!timestamp || !signature) {
    return { ok: false, status: 401, error: "Reporter signature is required" };
  }
  if (Math.abs(now - timestamp) > REPORT_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, status: 401, error: "Reporter signature has expired" };
  }
  if (!verifyReportSignature(address, targetType, targetId, timestamp, signature)) {
    return { ok: false, status: 401, error: "Invalid reporter signature" };
  }
  return { ok: true, status: 200 };
}
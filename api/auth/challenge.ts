import { createChallengeToken } from "../../src/lib/auth/challenge";
import { withObservability } from "../../src/lib/observability/wrapper";
import { withBodySizeLimit } from "../../src/lib/api/bodySizeLimit";
import { checkRateLimit } from "../../src/lib/observability/rateLimiter";
import {
  isAccountLocked,
  isCaptchaRequired,
  verifyCaptchaToken,
} from "../../src/lib/auth/abuseProtection";
import { metrics } from "../../src/lib/observability/metrics";
import { recordAuditEvent } from "../../server/src/services/auditTrail";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import { isPlaceholder } from "../../src/lib/validation/envValidator";
import { negotiateVersion } from "../../src/lib/api/versionGuard";
import { withVersion } from "../../src/lib/api/payloadVersion";
import {
  ChallengeRequestBody,
  parseRequestBody,
} from "../../src/lib/api/requestSchemas";
import { createHmac } from "crypto";

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json(apiError(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed."));
    return;
  }

  const version = negotiateVersion(req, res);
  if (!version) return;

  const clientIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress) as string;
  const body = req.body ?? {};
  const rawAddress = (body as { address?: unknown }).address;
  const rawPromptId = (body as { promptId?: unknown }).promptId;

  // Rate limit on /api/auth/challenge: max 10 requests per IP per minute
  const rateLimit = await checkRateLimit("challenge", clientIp, false);

  if (!rateLimit.success) {
    req.logger.warn({ clientIp }, "Rate limit exceeded for challenge issuance (IP)");
    metrics.trackRateLimitHit("challenge_ip", clientIp);
    void recordAuditEvent({
      action: "challenge_rate_limited",
      result: "blocked",
      promptId: rawAddress && rawPromptId ? String(rawPromptId) : null,
      walletAddress: rawAddress ? String(rawAddress) : null,
      requestId: req.requestId ?? null,
      clientIp,
      reason: "rate_limit_exceeded",
    });
    res.setHeader("X-RateLimit-Limit", rateLimit.limit);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("X-RateLimit-Reset", rateLimit.reset);
    res.status(429).json(
      apiError(ErrorCode.RATE_LIMIT_IP, "Too many requests. Please try again later.", {
        reset: rateLimit.reset,
      }, version),
    );
    return;
  }

  // Rate limit by wallet address if present (#449)
  if (rawAddress && typeof rawAddress === "string") {
    const walletRateLimit = await checkRateLimit("challenge", `wallet:${rawAddress}`, true);
    if (!walletRateLimit.success) {
      req.logger.warn({ address: rawAddress }, "Rate limit exceeded for challenge issuance (Wallet)");
      metrics.trackRateLimitHit("challenge_wallet", rawAddress);
      void recordAuditEvent({
        action: "challenge_rate_limited",
        result: "blocked",
        promptId: rawPromptId ? String(rawPromptId) : null,
        walletAddress: String(rawAddress),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "wallet_rate_limit_exceeded",
      });
      res.setHeader("X-RateLimit-Limit", walletRateLimit.limit);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", walletRateLimit.reset);
      res.status(429).json(
        apiError(ErrorCode.RATE_LIMIT_WALLET, "Too many challenge requests for this wallet.", {
          reset: walletRateLimit.reset,
        }, version),
      );
      return;
    }
  }

  res.setHeader("X-RateLimit-Limit", rateLimit.limit);
  res.setHeader("X-RateLimit-Remaining", rateLimit.remaining);
  res.setHeader("X-RateLimit-Reset", rateLimit.reset);

  // Check if wallet account is locked after repeated auth failures
  if (rawAddress && typeof rawAddress === "string") {
    const lockStatus = await isAccountLocked(rawAddress);
    if (lockStatus.locked) {
      req.logger.warn({ address: rawAddress }, "Challenge requested for locked account");
      void recordAuditEvent({
        action: "challenge_account_locked",
        result: "blocked",
        promptId: rawPromptId ? String(rawPromptId) : null,
        walletAddress: String(rawAddress),
        requestId: req.requestId ?? null,
        clientIp,
        reason: "account_locked",
      });
      res.status(423).json(
        apiError(
          ErrorCode.ACCOUNT_LOCKED,
          "Account is locked due to too many failed authentication attempts.",
          { lockedUntil: lockStatus.lockedUntil },
          version,
        ),
      );
      return;
    }
  }

  // Check if CAPTCHA is required due to repeated failures
  const addressStr = typeof rawAddress === "string" ? rawAddress : undefined;
  const captchaNeeded = await isCaptchaRequired(addressStr, clientIp);
  if (captchaNeeded) {
    const captchaToken =
      (body as { captchaToken?: unknown }).captchaToken ||
      req.headers["x-captcha-token"];

    if (!captchaToken || typeof captchaToken !== "string") {
      req.logger.warn({ address: addressStr, clientIp }, "CAPTCHA required for challenge request");
      void recordAuditEvent({
        action: "challenge_captcha_required",
        result: "blocked",
        promptId: rawPromptId ? String(rawPromptId) : null,
        walletAddress: addressStr ?? null,
        requestId: req.requestId ?? null,
        clientIp,
        reason: "captcha_required",
      });
      res.status(403).json(
        apiError(
          ErrorCode.CAPTCHA_REQUIRED,
          "CAPTCHA verification is required to proceed.",
          { captchaRequired: true },
          version,
        ),
      );
      return;
    }

    const captchaResult = await verifyCaptchaToken(captchaToken, clientIp);
    if (!captchaResult.valid) {
      req.logger.warn(
        { address: addressStr, clientIp, reason: captchaResult.reason },
        "Invalid CAPTCHA token",
      );
      void recordAuditEvent({
        action: "challenge_captcha_failed",
        result: "blocked",
        promptId: rawPromptId ? String(rawPromptId) : null,
        walletAddress: addressStr ?? null,
        requestId: req.requestId ?? null,
        clientIp,
        reason: captchaResult.reason ?? "invalid_captcha",
      });
      res.status(403).json(
        apiError(
          ErrorCode.CAPTCHA_INVALID,
          "Invalid or expired CAPTCHA verification.",
          { captchaRequired: true },
          version,
        ),
      );
      return;
    }
  }

  const secret = process.env.CHALLENGE_TOKEN_SECRET;
  if (!secret || isPlaceholder(secret) || secret.length < 16) {
    req.logger.error("CHALLENGE_TOKEN_SECRET is not configured correctly.");
    res.status(500).json(apiError(ErrorCode.CONFIGURATION_ERROR, "Configuration error.", undefined, version));
    return;
  }

  const parsed = parseRequestBody(ChallengeRequestBody, req.body);
  if (!parsed.success) {
    // Constant-time normalization: perform a dummy HMAC so the response
    // timing is indistinguishable from a valid-address path, preventing
    // wallet-address enumeration via timing side-channel.
    createHmac("sha256", secret).update("padding").digest("base64url");
    res.status(400).json(
      apiError(ErrorCode.MISSING_FIELDS, "address and promptId are required.", undefined, version),
    );
    return;
  }

  const { address, promptId } = parsed.data;

  const challenge = createChallengeToken(secret, address, promptId);

  metrics.trackChallengeIssued(String(address), String(promptId));
  req.logger.info({ address, promptId }, "Challenge token issued successfully");

  void recordAuditEvent({
    action: "challenge_issued",
    result: "success",
    promptId: String(promptId),
    walletAddress: String(address),
    requestId: req.requestId ?? null,
    clientIp,
    reason: null,
  });

  res.status(200).json(withVersion(challenge, version));
}

export default withObservability(withBodySizeLimit(handler), "auth/challenge");

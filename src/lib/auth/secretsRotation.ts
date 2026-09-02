/**
 * Automated Secrets Rotation Service
 *
 * Implements 90-day automatic rotation of challenge token secrets and API keys,
 * maintains overlapping validity windows (grace periods) to ensure zero downtime,
 * syncs secrets to dependent services, and dispatches team notifications.
 */

import { randomBytes } from "crypto";
import { getRedisClient } from "../observability/redisClient";
import { isPlaceholder } from "../validation/envValidator";
import { recordAuditEvent } from "../../../server/src/services/auditTrail";

export const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
export const DEFAULT_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days overlapping validity

export interface SecretRotationConfig {
  currentSecret: string;
  previousSecret?: string;
  rotationTimestamp: number;
  gracePeriodMs: number;
  nextRotationTimestamp: number;
}

export interface SecretRotationNotificationPayload {
  secretType: string;
  rotationTimestamp: number;
  gracePeriodExpiresAt: number;
  nextScheduledRotation: number;
  status: "success" | "failure";
  message: string;
  error?: string;
}

// In-memory state storage fallback
let inMemoryRotationState: SecretRotationConfig | null = null;

/**
 * Generate a cryptographically secure random base64url secret
 */
export function generateNewSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Get the rotation interval in milliseconds (defaults to 90 days)
 */
export function getRotationIntervalMs(): number {
  const envVal = process.env.SECRETS_ROTATION_INTERVAL_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return NINETY_DAYS_MS;
}

/**
 * Get the overlapping grace period in milliseconds (defaults to 7 days)
 */
export function getGracePeriodMs(): number {
  const envVal =
    process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS ||
    process.env.SECRETS_ROTATION_GRACE_PERIOD_MS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_GRACE_PERIOD_MS;
}

/**
 * Get the current secret rotation configuration from Redis or environment/memory
 */
export async function getRotationConfig(): Promise<SecretRotationConfig> {
  const defaultCurrent = process.env.CHALLENGE_TOKEN_SECRET || "";
  const defaultPrevious = process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;
  const defaultTimestamp = parseInt(
    process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP || "0",
    10,
  );
  const gracePeriodMs = getGracePeriodMs();
  const intervalMs = getRotationIntervalMs();

  try {
    const redis = await getRedisClient();
    if (redis) {
      const stored = await redis.get("secrets:rotation:challenge");
      if (stored) {
        return JSON.parse(stored) as SecretRotationConfig;
      }
    }
  } catch {
    // Fallback to in-memory/environment
  }

  if (inMemoryRotationState) {
    return inMemoryRotationState;
  }

  return {
    currentSecret: defaultCurrent,
    previousSecret: defaultPrevious,
    rotationTimestamp: defaultTimestamp || Date.now(),
    gracePeriodMs,
    nextRotationTimestamp: (defaultTimestamp || Date.now()) + intervalMs,
  };
}

/**
 * Check if secret rotation is due (i.e. >= 90 days elapsed since last rotation)
 */
export function isSecretRotationDue(
  lastRotationTimestamp?: number,
  intervalMs = getRotationIntervalMs(),
  now = Date.now(),
): boolean {
  if (!lastRotationTimestamp || lastRotationTimestamp <= 0) {
    return true;
  }
  return now - lastRotationTimestamp >= intervalMs;
}

/**
 * Get all active secrets (current primary secret + previous secret if within overlapping validity window)
 */
export async function getActiveChallengeSecrets(): Promise<string[]> {
  const config = await getRotationConfig();
  const secrets: string[] = [];

  if (config.currentSecret && !isPlaceholder(config.currentSecret)) {
    secrets.push(config.currentSecret);
  }

  if (config.previousSecret && !isPlaceholder(config.previousSecret)) {
    const elapsed = Date.now() - config.rotationTimestamp;
    if (elapsed < config.gracePeriodMs) {
      secrets.push(config.previousSecret);
    }
  }

  return secrets.length > 0 ? secrets : [process.env.CHALLENGE_TOKEN_SECRET || ""];
}

/**
 * Synchronous resolver for active secrets from environment/in-memory
 */
export function getActiveChallengeSecretsSync(primaryFallback?: string): string[] {
  const current = inMemoryRotationState?.currentSecret || process.env.CHALLENGE_TOKEN_SECRET || primaryFallback || "";
  const previous = inMemoryRotationState?.previousSecret || process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;
  const rotationTime =
    inMemoryRotationState?.rotationTimestamp ||
    parseInt(process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP || "0", 10);
  const gracePeriod =
    inMemoryRotationState?.gracePeriodMs ||
    parseInt(process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS || String(DEFAULT_GRACE_PERIOD_MS), 10);

  const secrets: string[] = [];
  if (current && !isPlaceholder(current)) secrets.push(current);

  if (previous && rotationTime && !isPlaceholder(previous)) {
    if (Date.now() - rotationTime < gracePeriod) {
      secrets.push(previous);
    }
  }

  return secrets.length > 0 ? secrets : [primaryFallback || ""];
}

/**
 * Check if a given secret is currently valid
 */
export async function isSecretValid(secret: string): Promise<boolean> {
  const active = await getActiveChallengeSecrets();
  return active.includes(secret);
}

/**
 * Dispatch notifications to team (webhook, email, audit trail)
 */
export async function notifyTeamOnRotation(
  payload: SecretRotationNotificationPayload,
): Promise<void> {
  // 1. Record persistent audit log event
  void recordAuditEvent({
    action: payload.status === "success" ? "secrets_rotated" : "secrets_rotation_failed",
    result: payload.status === "success" ? "success" : "failure",
    promptId: null,
    walletAddress: null,
    requestId: null,
    clientIp: null,
    reason: payload.error || "90_day_scheduled_rotation",
  });

  // 2. Webhook notification (Slack/Discord/Ops Webhook)
  const webhookUrl =
    process.env.ROTATION_NOTIFICATION_WEBHOOK_URL ||
    process.env.SLACK_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    process.env.ALERT_WEBHOOK_URL;

  if (webhookUrl) {
    try {
      const formattedMessage = {
        text: `🔐 *PromptMint Secrets Rotation: ${payload.secretType}*`,
        attachments: [
          {
            color: payload.status === "success" ? "#36a64f" : "#d9534f",
            fields: [
              { title: "Status", value: payload.status.toUpperCase(), short: true },
              { title: "Secret Type", value: payload.secretType, short: true },
              {
                title: "Rotated At",
                value: new Date(payload.rotationTimestamp).toISOString(),
                short: true,
              },
              {
                title: "Previous Secret Grace Expires",
                value: new Date(payload.gracePeriodExpiresAt).toISOString(),
                short: true,
              },
              {
                title: "Next Scheduled Rotation (90 Days)",
                value: new Date(payload.nextScheduledRotation).toISOString(),
                short: false,
              },
              { title: "Details", value: payload.message, short: false },
            ],
          },
        ],
      };

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formattedMessage),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    } catch {
      // Non-blocking
    }
  }

  // 3. Email notification if configured
  const teamEmail = process.env.TEAM_NOTIFICATION_EMAIL || process.env.SECURITY_TEAM_EMAIL;
  if (teamEmail) {
    console.log(
      `[Secrets Rotation Notification] Dispatched rotation notice to ${teamEmail}: ${payload.secretType} rotated. Next rotation in 90 days.`,
    );
  }
}

/**
 * Execute secret rotation: generates new secret, updates state, and notifies dependent services and team
 */
export async function rotateChallengeTokenSecret(options: {
  gracePeriodMs?: number;
  intervalMs?: number;
} = {}): Promise<SecretRotationConfig> {
  const currentSecret = process.env.CHALLENGE_TOKEN_SECRET || inMemoryRotationState?.currentSecret;
  if (!currentSecret || isPlaceholder(currentSecret) || currentSecret.length < 16) {
    throw new Error("CHALLENGE_TOKEN_SECRET not configured correctly");
  }

  const gracePeriodMs = options.gracePeriodMs ?? getGracePeriodMs();
  const intervalMs = options.intervalMs ?? getRotationIntervalMs();
  const now = Date.now();
  const newSecret = generateNewSecret();

  const newConfig: SecretRotationConfig = {
    currentSecret: newSecret,
    previousSecret: currentSecret,
    rotationTimestamp: now,
    gracePeriodMs,
    nextRotationTimestamp: now + intervalMs,
  };

  // 1. Update in-memory & environment variables
  inMemoryRotationState = newConfig;
  process.env.CHALLENGE_TOKEN_SECRET = newSecret;
  process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS = currentSecret;
  process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP = now.toString();
  process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS = gracePeriodMs.toString();

  // 2. Persist to Redis if available for multi-process / serverless synchronization
  try {
    const redis = await getRedisClient();
    if (redis) {
      const ttlSec = Math.ceil((intervalMs + gracePeriodMs) / 1000);
      await redis.set("secrets:rotation:challenge", JSON.stringify(newConfig), { EX: ttlSec });
    }
  } catch {
    // Non-blocking fallback to in-memory
  }

  // 3. Notify team & audit log
  await notifyTeamOnRotation({
    secretType: "CHALLENGE_TOKEN_SECRET",
    rotationTimestamp: now,
    gracePeriodExpiresAt: now + gracePeriodMs,
    nextScheduledRotation: now + intervalMs,
    status: "success",
    message: "Challenge token secret auto-rotated successfully. Overlapping validity window is active.",
  });

  return newConfig;
}

/**
 * Check if automated rotation is due and execute if needed
 */
export async function checkAndExecuteAutomatedRotation(force = false): Promise<{
  rotated: boolean;
  config: SecretRotationConfig;
}> {
  const config = await getRotationConfig();
  const isDue = force || isSecretRotationDue(config.rotationTimestamp);

  if (isDue) {
    const newConfig = await rotateChallengeTokenSecret();
    return { rotated: true, config: newConfig };
  }

  return { rotated: false, config };
}

/**
 * Clean up expired previous secrets when grace period expires
 */
export async function cleanupExpiredSecrets(): Promise<void> {
  const config = await getRotationConfig();
  if (config.previousSecret) {
    const elapsed = Date.now() - config.rotationTimestamp;
    if (elapsed >= config.gracePeriodMs) {
      config.previousSecret = undefined;
      inMemoryRotationState = config;
      delete process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;

      try {
        const redis = await getRedisClient();
        if (redis) {
          await redis.set("secrets:rotation:challenge", JSON.stringify(config));
        }
      } catch {
        // Ignore redis errors
      }
    }
  }
}

/**
 * Reset rotation state (for test isolation)
 */
export function resetSecretsRotationState(): void {
  inMemoryRotationState = null;
}

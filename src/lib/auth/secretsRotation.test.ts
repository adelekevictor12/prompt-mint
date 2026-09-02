// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSecretRotationDue,
  rotateChallengeTokenSecret,
  getActiveChallengeSecrets,
  getActiveChallengeSecretsSync,
  checkAndExecuteAutomatedRotation,
  cleanupExpiredSecrets,
  notifyTeamOnRotation,
  resetSecretsRotationState,
  NINETY_DAYS_MS,
} from "./secretsRotation";

vi.mock("../../../server/src/services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
}));

describe("secretsRotation service", () => {
  beforeEach(() => {
    resetSecretsRotationState();
    process.env.CHALLENGE_TOKEN_SECRET = "test-secret-1234567890abcdef";
    delete process.env.CHALLENGE_TOKEN_SECRET_PREVIOUS;
    delete process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP;
    delete process.env.CHALLENGE_TOKEN_GRACE_PERIOD_MS;
  });

  describe("90-day rotation schedule check", () => {
    it("returns true when no previous rotation timestamp exists", () => {
      expect(isSecretRotationDue(undefined)).toBe(true);
      expect(isSecretRotationDue(0)).toBe(true);
    });

    it("returns false when secret was rotated less than 90 days ago", () => {
      const eightyDaysAgo = Date.now() - 80 * 24 * 60 * 60 * 1000;
      expect(isSecretRotationDue(eightyDaysAgo)).toBe(false);
    });

    it("returns true when secret is 90 days old or older", () => {
      const ninetyDaysAgo = Date.now() - NINETY_DAYS_MS;
      const hundredDaysAgo = Date.now() - 100 * 24 * 60 * 60 * 1000;
      expect(isSecretRotationDue(ninetyDaysAgo)).toBe(true);
      expect(isSecretRotationDue(hundredDaysAgo)).toBe(true);
    });
  });

  describe("overlapping validity windows (grace period)", () => {
    it("returns only current secret when no rotation has occurred", async () => {
      const secrets = await getActiveChallengeSecrets();
      expect(secrets).toHaveLength(1);
      expect(secrets[0]).toBe("test-secret-1234567890abcdef");
    });

    it("maintains both current and previous secrets during overlapping grace window", async () => {
      const oldSecret = process.env.CHALLENGE_TOKEN_SECRET!;
      const config = await rotateChallengeTokenSecret({ gracePeriodMs: 7 * 24 * 60 * 60 * 1000 });

      expect(config.currentSecret).not.toBe(oldSecret);
      expect(config.previousSecret).toBe(oldSecret);
      expect(config.nextRotationTimestamp).toBe(config.rotationTimestamp + NINETY_DAYS_MS);

      const active = await getActiveChallengeSecrets();
      expect(active).toContain(config.currentSecret);
      expect(active).toContain(oldSecret);
      expect(active).toHaveLength(2);

      const syncActive = getActiveChallengeSecretsSync();
      expect(syncActive).toContain(config.currentSecret);
      expect(syncActive).toContain(oldSecret);
    });

    it("invalidates previous secret after grace period expires", async () => {
      const oldSecret = process.env.CHALLENGE_TOKEN_SECRET!;
      // Short grace period in past
      const config = await rotateChallengeTokenSecret({ gracePeriodMs: 10 });
      
      // Fast-forward past grace period
      config.rotationTimestamp = Date.now() - 5000;
      process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP = config.rotationTimestamp.toString();

      await cleanupExpiredSecrets();

      const active = await getActiveChallengeSecrets();
      expect(active).toContain(config.currentSecret);
      expect(active).not.toContain(oldSecret);
    });
  });

  describe("automated rotation check and execution", () => {
    it("auto-rotates when secret is 90+ days old", async () => {
      const oldSecret = "old-secret-from-90-days-ago-12345";
      process.env.CHALLENGE_TOKEN_SECRET = oldSecret;
      process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP = (Date.now() - 95 * 24 * 60 * 60 * 1000).toString();

      const result = await checkAndExecuteAutomatedRotation();
      expect(result.rotated).toBe(true);
      expect(result.config.currentSecret).not.toBe(oldSecret);
      expect(result.config.previousSecret).toBe(oldSecret);
    });

    it("skips rotation when secret is not yet 90 days old unless forced", async () => {
      const recentSecret = "recent-secret-from-10-days-ago";
      process.env.CHALLENGE_TOKEN_SECRET = recentSecret;
      process.env.CHALLENGE_TOKEN_ROTATION_TIMESTAMP = (Date.now() - 10 * 24 * 60 * 60 * 1000).toString();

      const skipResult = await checkAndExecuteAutomatedRotation(false);
      expect(skipResult.rotated).toBe(false);
      expect(process.env.CHALLENGE_TOKEN_SECRET).toBe(recentSecret);

      const forceResult = await checkAndExecuteAutomatedRotation(true);
      expect(forceResult.rotated).toBe(true);
      expect(forceResult.config.currentSecret).not.toBe(recentSecret);
    });
  });

  describe("team notification dispatch", () => {
    it("records audit trail event and handles notification payload", async () => {
      const { recordAuditEvent } = await import("../../../server/src/services/auditTrail");

      await notifyTeamOnRotation({
        secretType: "CHALLENGE_TOKEN_SECRET",
        rotationTimestamp: Date.now(),
        gracePeriodExpiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        nextScheduledRotation: Date.now() + NINETY_DAYS_MS,
        status: "success",
        message: "Secret rotated successfully.",
      });

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "secrets_rotated",
          result: "success",
        }),
      );
    });
  });
});

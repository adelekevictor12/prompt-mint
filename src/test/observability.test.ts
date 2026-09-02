import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../lib/observability/rateLimiter";
import { logger } from "../lib/observability/logger";

describe("Observability Utilities", () => {
  describe("Rate Limiter", () => {
    it("should allow requests within limit", async () => {
      const result = await checkRateLimit("challenge", "test-ip-1", false);
      expect(result.success).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it("should enforce wallet-keyed rate limiting", async () => {
      const wallet = "GBALICE1234567890";
      // Challenge limit for authenticated wallet is 15
      for (let i = 0; i < 15; i++) {
        const r = await checkRateLimit("challenge", `wallet:${wallet}`, true);
        expect(r.success).toBe(true);
      }
      const blocked = await checkRateLimit("challenge", `wallet:${wallet}`, true);
      expect(blocked.success).toBe(false);
      expect(blocked.remaining).toBe(0);
    });
  });


  describe("Logger", () => {
    it("should be configured with correct level", () => {
      expect(logger.level).toBe("silent"); // Since we set NODE_ENV=test
    });
  });
});

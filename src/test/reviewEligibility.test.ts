import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReviewClient } from "../lib/reviews/reviewClient";
import eligibilityHandler from "../../api/reviews/eligibility";

describe("Review Eligibility Checks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("ReviewClient.checkEligibility", () => {
    it("returns eligible status for verified buyers", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            eligible: true,
            verified: true,
            alreadyReviewed: false,
            reason: "Verified purchaser eligible to review.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await ReviewClient.checkEligibility("1", "GBUYER12345");
      expect(res.eligible).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.alreadyReviewed).toBe(false);
    });

    it("returns ineligible for non-purchaser", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            eligible: false,
            verified: false,
            alreadyReviewed: false,
            reason: "Only verified purchasers with on-chain access can submit reviews.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await ReviewClient.checkEligibility("1", "GNONBUYER999");
      expect(res.eligible).toBe(false);
      expect(res.verified).toBe(false);
    });

    it("returns alreadyReviewed status for repeat reviewers", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            eligible: false,
            verified: true,
            alreadyReviewed: true,
            reason: "You have already submitted a review for this prompt.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await ReviewClient.checkEligibility("1", "GBUYER12345");
      expect(res.eligible).toBe(false);
      expect(res.alreadyReviewed).toBe(true);
    });
  });

  describe("api/reviews/eligibility Handler", () => {
    it("returns 400 when missing promptId or userAddress", async () => {
      let responseStatus = 0;
      let responseJson: any = null;

      const req = { method: "GET", query: {}, headers: {} };
      const res = {
        status: (code: number) => {
          responseStatus = code;
          return res;
        },
        json: (data: any) => {
          responseJson = data;
          return res;
        },
        setHeader: vi.fn(),
      };

      await eligibilityHandler(req, res);
      expect(responseStatus).toBe(400);
      expect(responseJson.error).toContain("Missing required");
    });
  });
});

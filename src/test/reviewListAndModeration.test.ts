import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import listReviews from "../../api/reviews/list";
import bulkModeration from "../../api/moderation/actions";
import editReview from "../../api/reviews/edit";
import { ReviewClient } from "../lib/reviews/reviewClient";
import { buildModeratorAuthMessage } from "../lib/auth/challenge";

function signModeratorAction(keypair: Keypair, purpose: string, timestamp = Date.now()) {
  const message = buildModeratorAuthMessage(keypair.publicKey(), purpose, timestamp);
  const signature = keypair.sign(Buffer.from(message, "utf8")).toString("base64");
  return { moderatorTimestamp: timestamp, moderatorSignature: signature };
}

function responseRecorder() {
  let statusCode = 0;
  let body: any;
  const headers: Record<string, string> = {};
  const response = {
    status(code: number) { statusCode = code; return response; },
    json(data: any) { body = data; return response; },
    setHeader(key: string, value: string) { headers[key] = value; return response; },
    getHeader(key: string) { return headers[key]; },
  };
  return { response, get status() { return statusCode; }, get body() { return body; } };
}

describe("review list contract", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("paginates and filters while preserving overall statistics", async () => {
    const recorded = responseRecorder();
    await listReviews({ method: "GET", headers: {}, query: { promptId: "1", page: "1", limit: "1", rating: "5", sort: "helpful" } }, recorded.response);
    expect(recorded.status).toBe(200);
    expect(recorded.body.reviews).toHaveLength(1);
    expect(recorded.body.reviews[0].rating).toBe(5);
    expect(recorded.body.pagination).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(recorded.body.stats.total).toBe(2);
  });

  it("rejects unsafe list query values", async () => {
    const recorded = responseRecorder();
    await listReviews({ method: "GET", headers: {}, query: { promptId: "1", page: "0", sort: "random" } }, recorded.response);
    expect(recorded.status).toBe(400);
  });

  it("keeps the frontend client aligned with pagination and filter metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      reviews: [], stats: { total: 0, averageRating: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      pagination: { page: 2, limit: 10, total: 11, totalPages: 2, hasMore: false },
      filters: { sort: "helpful", rating: 4 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await ReviewClient.getReviews("1", { page: 2, sort: "helpful", rating: 4 });
    expect(result.pagination.totalPages).toBe(2);
    expect(result.filters).toEqual({ sort: "helpful", rating: 4 });
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("sort=helpful"));
  });
});

describe("review editing and bulk moderation safeguards", () => {
  it("rejects review edits from an address other than the author before access checks", async () => {
    const recorded = responseRecorder();
    await editReview({ method: "PUT", body: { promptId: "1", reviewId: "review_1", userAddress: "GNOTAUTHOR", rating: 5, text: "This is a valid edited review." } }, recorded.response);
    expect(recorded.status).toBe(403);
    expect(recorded.body.error).toContain("author");
  });

  describe("bulk moderation authentication", () => {
    let saved: string | undefined;
    let moderator: Keypair;

    beforeEach(() => {
      saved = process.env.MODERATOR_ADDRESSES;
      moderator = Keypair.random();
      process.env.MODERATOR_ADDRESSES = moderator.publicKey();
    });

    afterEach(() => {
      if (saved === undefined) delete process.env.MODERATOR_ADDRESSES;
      else process.env.MODERATOR_ADDRESSES = saved;
    });

    it("requires explicit confirmation before performing bulk actions", async () => {
      const recorded = responseRecorder();
      const auth = signModeratorAction(moderator, "moderation-action");
      await bulkModeration(
        {
          method: "POST",
          body: {
            moderatorAddress: moderator.publicKey(),
            ...auth,
            actions: [{ action: "review_removed", targetType: "review", targetId: "review_1", reason: "Policy violation" }],
          },
        },
        recorded.response,
      );
      expect(recorded.status).toBe(400);
      expect(recorded.body.error).toContain("confirmed");
    });

    it("rejects requests missing a moderator signature", async () => {
      const recorded = responseRecorder();
      await bulkModeration(
        {
          method: "POST",
          body: {
            moderatorAddress: moderator.publicKey(),
            confirmed: true,
            actions: [{ action: "review_removed", targetType: "review", targetId: "review_1", reason: "Policy violation" }],
          },
        },
        recorded.response,
      );
      expect(recorded.status).toBe(401);
      expect(recorded.body.error).toContain("signature");
    });

    it("rejects requests signed by a non-moderator wallet", async () => {
      const recorded = responseRecorder();
      const impostor = Keypair.random();
      const auth = signModeratorAction(impostor, "moderation-action");
      await bulkModeration(
        {
          method: "POST",
          body: {
            moderatorAddress: impostor.publicKey(),
            ...auth,
            confirmed: true,
            actions: [{ action: "review_removed", targetType: "review", targetId: "review_1", reason: "Policy violation" }],
          },
        },
        recorded.response,
      );
      expect(recorded.status).toBe(403);
      expect(recorded.body.error).toContain("Unauthorized");
    });

    it("rejects a signature that does not match the claimed moderator address", async () => {
      const recorded = responseRecorder();
      const otherModerator = Keypair.random();
      process.env.MODERATOR_ADDRESSES = `${moderator.publicKey()},${otherModerator.publicKey()}`;
      // Sign as otherModerator but claim to be `moderator`.
      const auth = signModeratorAction(otherModerator, "moderation-action");
      await bulkModeration(
        {
          method: "POST",
          body: {
            moderatorAddress: moderator.publicKey(),
            ...auth,
            confirmed: true,
            actions: [{ action: "review_removed", targetType: "review", targetId: "review_1", reason: "Policy violation" }],
          },
        },
        recorded.response,
      );
      expect(recorded.status).toBe(401);
      expect(recorded.body.error).toContain("Invalid moderator signature");
    });

    it("rejects an expired moderator signature", async () => {
      const recorded = responseRecorder();
      const auth = signModeratorAction(moderator, "moderation-action", Date.now() - 10 * 60 * 1000);
      await bulkModeration(
        {
          method: "POST",
          body: {
            moderatorAddress: moderator.publicKey(),
            ...auth,
            confirmed: true,
            actions: [{ action: "review_removed", targetType: "review", targetId: "review_1", reason: "Policy violation" }],
          },
        },
        recorded.response,
      );
      expect(recorded.status).toBe(401);
      expect(recorded.body.error).toContain("expired");
    });

    it("accepts a correctly signed, confirmed bulk action", async () => {
      const recorded = responseRecorder();
      const auth = signModeratorAction(moderator, "moderation-action");
      await bulkModeration(
        {
          method: "POST",
          body: {
            moderatorAddress: moderator.publicKey(),
            ...auth,
            confirmed: true,
            actions: [{ action: "review_removed", targetType: "review", targetId: "review_1", reason: "Policy violation" }],
          },
        },
        recorded.response,
      );
      expect(recorded.status).toBe(200);
      expect(recorded.body.success).toBe(true);
    });
  });
});

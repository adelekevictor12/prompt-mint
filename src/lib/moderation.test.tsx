// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  submitReport,
  fetchModerationQueue,
  moderationAction,
  fetchPromptStatus,
  signReportAuth,
  type ReportTargetType,
} from "@/lib/moderation";
import type { SignMessageFn } from "@/lib/auth/moderatorAuth";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeSign(): SignMessageFn {
  return (async (message: string) => {
    return { signedMessage: `sig:${message.length}` };
  }) as SignMessageFn;
}

const reporterAddress = "GREPORTER0000000000000000000000000000000000000000000000";
const targetType: ReportTargetType = "prompt";
const targetId = "prompt_1";

describe("moderation API client", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => mockFetch.mockReset());

  it("signs a report auth message scoped to the target", async () => {
    const sign = makeSign();
    const proof = await signReportAuth(reporterAddress, targetType, targetId, sign);
    expect(proof.reporterTimestamp).toBeTypeOf("number");
    expect(proof.reporterSignature).toContain("sig:");
  });

  it("submits a report and returns the created record", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        report: {
          id: "rep_1",
          reporterAddress,
          targetType,
          targetId,
          reason: "spam",
          status: "pending",
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    });

    const report = await submitReport({
      reporterAddress,
      signMessage: makeSign(),
      targetType,
      targetId,
      reason: "spam",
      details: "spammy",
    });

    expect(report.id).toBe("rep_1");
    expect(report.status).toBe("pending");
    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.targetId).toBe(targetId);
    expect(body.reporterSignature).toBeTruthy();
  });

  it("throws on a non-OK report response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid reporter signature" }),
    });
    await expect(
      submitReport({ reporterAddress, signMessage: makeSign(), targetType, targetId, reason: "spam" }),
    ).rejects.toThrow(/Invalid reporter signature/);
  });

  it("fetches the moderation queue with moderator auth", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [{ id: "rep_2" }], pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false } }),
    });
    const moderator = "GMOD0000000000000000000000000000000000000000000000000";
    const { entries, pagination } = await fetchModerationQueue({
      moderatorAddress: moderator,
      signMessage: makeSign(),
      filters: { status: "pending" },
    });
    expect(entries).toHaveLength(1);
    expect(pagination.total).toBe(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("status=pending");
    expect(url).toContain("moderatorAddress=");
  });

  it("applies moderation actions with confirmed flag", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, applied: [{ id: "m1" }], errors: [] }),
    });
    const moderator = "GMOD0000000000000000000000000000000000000000000000000";
    const result = await moderationAction({
      moderatorAddress: moderator,
      signMessage: makeSign(),
      actions: [{ action: "prompt_takedown", targetId: "prompt_1", targetType: "prompt", reason: "copyright" }],
    });
    expect(result.success).toBe(true);
    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.confirmed).toBe(true);
    expect(body.actions[0].action).toBe("prompt_takedown");
  });

  it("fetches public prompt takedown status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ promptId: "prompt_1", takenDown: true, reason: "copyright", updatedAt: 123 }),
    });
    const status = await fetchPromptStatus("prompt_1");
    expect(status.takenDown).toBe(true);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("promptId=prompt_1");
  });
});

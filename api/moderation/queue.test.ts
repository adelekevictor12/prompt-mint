// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildModeratorAuthMessage } from "../../src/lib/auth/challenge";
import { addReport } from "./data";

const moderator = Keypair.random();

function sign(message: string, kp: Keypair): string {
  return Buffer.from(kp.sign(Buffer.from(message, "utf8"))).toString("base64");
}

function buildReq(query: Record<string, string>, method = "GET") {
  return {
    method,
    headers: {},
    query,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    requestId: "test",
    socket: { remoteAddress: "127.0.0.1" },
  };
}

async function invokeQueue(query: Record<string, string>, method = "GET") {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};
  const req = buildReq(query, method);
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
  const handler = (await import("./queue")).default;
  // @ts-expect-error test handler invocation
  await handler(req, res);
  return { statusCode, responseData };
}

describe("moderation queue endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MODERATOR_ADDRESSES = moderator.publicKey();
    // Seed deterministic reports.
    addReport({
      reporterAddress: "GREPORTER1",
      targetType: "prompt",
      targetId: "prompt_abc",
      reason: "copyright",
      details: "copied content",
    });
    addReport({
      reporterAddress: "GREPORTER2",
      targetType: "review",
      targetId: "review_xyz",
      reason: "spam",
    });
  });

  it("rejects requests without a moderator address", async () => {
    const { statusCode } = await invokeQueue({});
    expect(statusCode).toBe(401);
  });

  it("rejects requests from a non-moderator", async () => {
    const stranger = Keypair.random();
    const ts = Date.now();
    const { statusCode } = await invokeQueue({
      moderatorAddress: stranger.publicKey(),
      moderatorTimestamp: String(ts),
      moderatorSignature: sign(buildModeratorAuthMessage(stranger.publicKey(), "moderation-queue", ts), stranger),
    });
    expect(statusCode).toBe(403);
  });

  it("returns queued reports for an authorized moderator", async () => {
    const ts = Date.now();
    const { statusCode, responseData } = await invokeQueue({
      moderatorAddress: moderator.publicKey(),
      moderatorTimestamp: String(ts),
      moderatorSignature: sign(buildModeratorAuthMessage(moderator.publicKey(), "moderation-queue", ts), moderator),
    });
    expect(statusCode).toBe(200);
    const entries = (responseData as any).entries as unknown[];
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect((responseData as any).pagination.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by target type", async () => {
    const ts = Date.now();
    const { statusCode, responseData } = await invokeQueue({
      moderatorAddress: moderator.publicKey(),
      moderatorTimestamp: String(ts),
      moderatorSignature: sign(buildModeratorAuthMessage(moderator.publicKey(), "moderation-queue", ts), moderator),
      targetType: "review",
    });
    expect(statusCode).toBe(200);
    const entries = (responseData as any).entries as Array<{ targetType: string }>;
    expect(entries.every((e) => e.targetType === "review")).toBe(true);
  });
});

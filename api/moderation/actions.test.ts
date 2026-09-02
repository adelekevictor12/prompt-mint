// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildModeratorAuthMessage } from "../../src/lib/auth/challenge";
import {
  addReport,
  getReportById,
  getPromptModerationState,
  getModerationLogs,
  setPromptModerationState,
} from "./data";

const moderator = Keypair.random();

function sign(message: string, kp: Keypair): string {
  return Buffer.from(kp.sign(Buffer.from(message, "utf8"))).toString("base64");
}

function moderatorProof(kp: Keypair, purpose: string) {
  const ts = Date.now();
  return {
    moderatorAddress: kp.publicKey(),
    moderatorTimestamp: ts,
    moderatorSignature: sign(buildModeratorAuthMessage(kp.publicKey(), purpose, ts), kp),
  };
}

async function invoke(body: Record<string, unknown>) {
  let statusCode = 0;
  let responseData: Record<string, unknown> = {};
  const req = {
    method: "POST",
    headers: {},
    body,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    requestId: "test",
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(d: Record<string, unknown>) { responseData = d; return this; },
    setHeader: vi.fn(),
  };
  const handler = (await import("./actions")).default;
  // @ts-expect-error test handler invocation
  await handler(req, res);
  return { statusCode, responseData };
}

describe("moderation actions endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MODERATOR_ADDRESSES = moderator.publicKey();
  });

  it("requires confirmed: true", async () => {
    const proof = moderatorProof(moderator, "moderation-action");
    const { statusCode } = await invoke({ ...proof, confirmed: false, actions: [] });
    expect(statusCode).toBe(400);
  });

  it("rejects mismatched action and target type", async () => {
    const proof = moderatorProof(moderator, "moderation-action");
    const { statusCode, responseData } = await invoke({
      ...proof,
      confirmed: true,
      actions: [{ action: "user_warned", targetId: "x", targetType: "prompt", reason: "bad" }],
    });
    expect(statusCode).toBe(207);
    expect((responseData as any).errors.length).toBe(1);
  });

  it("resolves a report and logs it", async () => {
    const report = addReport({
      reporterAddress: "GREPORTER1",
      targetType: "prompt",
      targetId: "prompt_xyz",
      reason: "spam",
    });
    const proof = moderatorProof(moderator, "moderation-action");
    const before = getModerationLogs().length;
    const { statusCode, responseData } = await invoke({
      ...proof,
      confirmed: true,
      actions: [{ action: "report_resolved", targetId: report.id, targetType: "report", reason: "Reviewed" }],
    });
    expect(statusCode).toBe(200);
    expect((responseData as any).success).toBe(true);
    expect(getReportById(report.id)?.status).toBe("resolved");
    expect(getModerationLogs().length).toBe(before + 1);
  });

  it("takes down a prompt and sets its moderation state", async () => {
    const proof = moderatorProof(moderator, "moderation-action");
    const { statusCode } = await invoke({
      ...proof,
      confirmed: true,
      actions: [{ action: "prompt_takedown", targetId: "prompt_td", targetType: "prompt", reason: "Copyright" }],
    });
    expect(statusCode).toBe(200);
    expect(getPromptModerationState("prompt_td").status).toBe("taken_down");
  });

  it("reinstates a previously taken-down prompt", async () => {
    setPromptModerationState("prompt_rt", "taken_down");
    const proof = moderatorProof(moderator, "moderation-action");
    const { statusCode } = await invoke({
      ...proof,
      confirmed: true,
      actions: [{ action: "prompt_reinstated", targetId: "prompt_rt", targetType: "prompt", reason: "Appeal granted" }],
    });
    expect(statusCode).toBe(200);
    expect(getPromptModerationState("prompt_rt").status).toBe("active");
  });
});

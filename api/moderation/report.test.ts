// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  buildReportAuthMessage,
} from "../../src/lib/auth/challenge";
import { ErrorCode } from "../../src/lib/api/errorCodes";

const reporter = Keypair.random();
const moderator = Keypair.random();

function sign(address: string, message: string, kp: Keypair): string {
  return Buffer.from(kp.sign(Buffer.from(message, "utf8"))).toString("base64");
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
  const handler = (await import("./report")).default;
  // @ts-expect-error test handler invocation
  await handler(req, res);
  return { statusCode, responseData };
}

describe("abuse report endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MODERATOR_ADDRESSES = moderator.publicKey();
  });

  it("rejects non-POST methods", async () => {
    const handler = (await import("./report")).default;
    let statusCode = 0;
    const req = { method: "GET", headers: {}, body: {}, logger: { error: vi.fn() } };
    const res = { status(c: number) { statusCode = c; return this; }, json: () => this, setHeader: vi.fn() };
    // @ts-expect-error test handler invocation
    await handler(req, res);
    expect(statusCode).toBe(405);
  });

  it("rejects a report with a missing target", async () => {
    const { statusCode, responseData } = await invoke({ reason: "spam" });
    expect(statusCode).toBe(400);
    expect((responseData as any).code).toBe(ErrorCode.MISSING_FIELDS);
  });

  it("rejects an invalid reason", async () => {
    const { statusCode, responseData } = await invoke({
      targetType: "prompt",
      targetId: "42",
      reason: "not-a-real-reason",
    });
    expect(statusCode).toBe(400);
    expect((responseData as any).code).toBe(ErrorCode.INVALID_INPUT);
  });

  it("rejects a report without a valid reporter signature", async () => {
    const { statusCode, responseData } = await invoke({
      reporterAddress: reporter.publicKey(),
      targetType: "prompt",
      targetId: "42",
      reason: "spam",
    });
    expect(statusCode).toBe(401);
  });

  it("accepts a properly signed report", async () => {
    const timestamp = Date.now();
    const signature = sign(
      reporter.publicKey(),
      buildReportAuthMessage(reporter.publicKey(), "prompt", "42", timestamp),
      reporter,
    );
    const { statusCode, responseData } = await invoke({
      reporterAddress: reporter.publicKey(),
      reporterTimestamp: timestamp,
      reporterSignature: signature,
      targetType: "prompt",
      targetId: "42",
      reason: "spam",
      details: "This is spammy content",
    });
    expect(statusCode).toBe(201);
    expect((responseData as any).success).toBe(true);
    expect((responseData as any).report.targetId).toBe("42");
    expect((responseData as any).report.status).toBe("pending");
  });

  it("rejects a report when the signature does not match the address", async () => {
    const timestamp = Date.now();
    const signature = sign(
      reporter.publicKey(),
      buildReportAuthMessage(reporter.publicKey(), "prompt", "42", timestamp),
      reporter,
    );
    const { statusCode } = await invoke({
      reporterAddress: moderator.publicKey(), // mismatched address
      reporterTimestamp: timestamp,
      reporterSignature: signature,
      targetType: "prompt",
      targetId: "42",
      reason: "spam",
    });
    expect(statusCode).toBe(401);
  });

  it("rejects a duplicate open report from the same reporter", async () => {
    const timestamp = Date.now();
    const first = await invoke({
      reporterAddress: reporter.publicKey(),
      reporterTimestamp: timestamp,
      reporterSignature: sign(
        reporter.publicKey(),
        buildReportAuthMessage(reporter.publicKey(), "prompt", "77", timestamp),
        reporter,
      ),
      targetType: "prompt",
      targetId: "77",
      reason: "scam",
    });
    expect(first.statusCode).toBe(201);

    const timestamp2 = Date.now();
    const second = await invoke({
      reporterAddress: reporter.publicKey(),
      reporterTimestamp: timestamp2,
      reporterSignature: sign(
        reporter.publicKey(),
        buildReportAuthMessage(reporter.publicKey(), "prompt", "77", timestamp2),
        reporter,
      ),
      targetType: "prompt",
      targetId: "77",
      reason: "scam",
    });
    expect(second.statusCode).toBe(409);
  });
});

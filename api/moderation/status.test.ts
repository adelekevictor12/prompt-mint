// @vitest-environment node

import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildModeratorAuthMessage } from "../../src/lib/auth/challenge";
import { getPromptModerationState, setPromptModerationState, addReport } from "./data";

const moderator = Keypair.random();

function sign(message: string, kp: Keypair): string {
  return Buffer.from(kp.sign(Buffer.from(message, "utf8"))).toString("base64");
}

describe("public prompt status endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MODERATOR_ADDRESSES = moderator.publicKey();
  });

  async function invoke(query: Record<string, string>) {
    let statusCode = 0;
    let responseData: Record<string, unknown> = {};
    const req = { method: "GET", headers: {}, query, logger: { error: vi.fn() }, requestId: "t" };
    const res = {
      status(c: number) { statusCode = c; return this; },
      json(d: Record<string, unknown>) { responseData = d; return this; },
      setHeader: vi.fn(),
    };
    const handler = (await import("./status")).default;
    // @ts-expect-error test handler invocation
    await handler(req, res);
    return { statusCode, responseData };
  }

  it("requires a promptId", async () => {
    const { statusCode } = await invoke({});
    expect(statusCode).toBe(400);
  });

  it("reports active by default", async () => {
    const { statusCode, responseData } = await invoke({ promptId: "prompt_active" });
    expect(statusCode).toBe(200);
    expect((responseData as any).takenDown).toBe(false);
  });

  it("reflects a takedown set via the data store", async () => {
    setPromptModerationState("prompt_down", "taken_down", { reason: "copyright" });
    const state = getPromptModerationState("prompt_down");
    expect(state.status).toBe("taken_down");

    const { statusCode, responseData } = await invoke({ promptId: "prompt_down" });
    expect(statusCode).toBe(200);
    expect((responseData as any).takenDown).toBe(true);
    expect((responseData as any).reason).toBe("copyright");
  });
});

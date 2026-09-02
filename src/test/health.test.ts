import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import handler from "../../api/health";

vi.mock("../../server/src/db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../server/src/models/IndexerState", () => ({
  IndexerState: {
    findOne: vi.fn().mockResolvedValue({ lastIndexedLedger: 12345 }),
  },
}));

vi.mock("../../src/lib/observability/wrapper", () => ({
  withObservability: (fn: any) => fn,
}));

describe("Health API", () => {
  const originalEnv = { ...process.env };
  const validContractId = "CC6P4I3KZQ7VMA27SPQ3PYT6XTV4QFK3BVG2K3SJQK5NZ2QNKM6QVZ5Q";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID = validContractId;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function invokeHealth() {
    let statusCode = 0;
    let responseData: any = {};

    const req = {
      method: "GET",
      headers: {},
      url: "/api/health",
      socket: { remoteAddress: "127.0.0.1" },
    };

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        responseData = data;
        return this;
      },
      setHeader: vi.fn(),
    };

    // @ts-expect-error test handler invocation
    await handler(req, res);

    return { statusCode, responseData };
  }

  it("should return 200 and ok status when dependencies are healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { status: "healthy" } }),
      }),
    );

    const { statusCode, responseData } = await invokeHealth();

    expect(statusCode).toBe(200);
    expect(responseData.status).toBe("ok");
    expect(responseData.timestamp).toBeDefined();
    expect(responseData.rpc.status).toBe("up");
    expect(responseData.contractConfig.configured).toBe(true);
  });

  it("should return 503 and degraded status when PUBLIC_PROMPT_HASH_CONTRACT_ID is missing", async () => {
    delete process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { status: "healthy" } }),
      }),
    );

    const { statusCode, responseData } = await invokeHealth();

    expect(statusCode).toBe(503);
    expect(responseData.status).toBe("degraded");
    expect(responseData.contractConfig.configured).toBe(false);
    expect(responseData.contractConfig.error).toBeDefined();
  });

  it("should return 503 and degraded status when RPC is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network connection refused")),
    );

    const { statusCode, responseData } = await invokeHealth();

    expect(statusCode).toBe(503);
    expect(responseData.status).toBe("degraded");
    expect(responseData.rpc.status).toBe("down");
    expect(responseData.rpc.error).toContain("Network connection refused");
  });
});

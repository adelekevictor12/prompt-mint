import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectDbMock, promptFindMock } = vi.hoisted(() => ({
  connectDbMock: vi.fn(),
  promptFindMock: vi.fn(),
}));

vi.mock("../src/lib/observability/wrapper", () => ({
  withObservability: (handler: unknown) => handler,
}));

vi.mock("../server/src/db/connectDb", () => ({
  default: connectDbMock,
}));

vi.mock("../server/src/models/Prompt", () => ({
  default: {
    find: promptFindMock,
  },
}));

import handler from "./sitemap";

function createRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    send(data: string) {
      this.body = data;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
  };
}

describe("GET /api/sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://example.com";
  });

  it("returns XML with indexed active listings when the database is reachable", async () => {
    connectDbMock.mockResolvedValue(undefined);
    promptFindMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        { _id: "listing-1", updatedAt: new Date("2024-03-01T00:00:00.000Z") },
      ]),
    });

    const res = createRes();
    await handler({ method: "GET" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.body).toContain("https://example.com/browse?promptId=listing-1");
    expect(res.body).toContain("2024-03-01");
  });

  it("falls back to base routes and surfaces errors when the index cannot be read", async () => {
    connectDbMock.mockRejectedValue(new Error("Mongo unavailable"));

    const res = createRes();
    await handler({ method: "GET" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-sitemap-error"]).toBe("Mongo unavailable");
    expect(res.body).toContain("https://example.com/");
    expect(res.body).toContain("https://example.com/browse");
    expect(res.body).not.toContain("promptId=");
  });
});

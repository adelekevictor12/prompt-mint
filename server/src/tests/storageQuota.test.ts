import httpMocks from "node-mocks-http";
import { CreatePrompt, GetCreatorStorageQuota, getStorageQuotaBytes, getUsedStorageBytes } from "../controllers/controllers";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import User from "../models/User";

jest.mock("../db/connectDb");
jest.mock("../models/User", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn(),
  },
}));
jest.mock("../models/Prompt", () => {
  const mockPromptConstructor: any = jest.fn().mockImplementation((data) => ({
    ...data,
    _id: "p_new",
    save: jest.fn().mockResolvedValue(true),
  }));
  mockPromptConstructor.findOne = jest.fn();
  mockPromptConstructor.find = jest.fn();
  return {
    __esModule: true,
    default: mockPromptConstructor,
    Prompt: mockPromptConstructor,
  };
});
jest.mock("../services/cacheService");

describe("Creator Storage Quota Enforcement (#198)", () => {
  const originalQuota = process.env.STORAGE_QUOTA_BYTES_PER_CREATOR;

  beforeEach(() => {
    jest.resetAllMocks();
    (connectDb as jest.Mock).mockResolvedValue(true);
    delete process.env.STORAGE_QUOTA_BYTES_PER_CREATOR;
  });

  afterEach(() => {
    if (originalQuota !== undefined) {
      process.env.STORAGE_QUOTA_BYTES_PER_CREATOR = originalQuota;
    } else {
      delete process.env.STORAGE_QUOTA_BYTES_PER_CREATOR;
    }
  });

  it("calculates default quota as 50 MB", () => {
    expect(getStorageQuotaBytes()).toBe(50 * 1024 * 1024);
  });

  it("respects STORAGE_QUOTA_BYTES_PER_CREATOR environment variable", () => {
    process.env.STORAGE_QUOTA_BYTES_PER_CREATOR = "1048576"; // 1 MB
    expect(getStorageQuotaBytes()).toBe(1048576);
  });

  it("calculates total used storage bytes across creator prompts", async () => {
    const mockPrompts = [
      { content: "abc", title: "title1", image: "https://example.com/img1.png" },
      { content: "defgh", title: "title2", image: "https://example.com/img2.png" },
    ];
    (Prompt.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue(mockPrompts),
    });

    const used = await getUsedStorageBytes("user123");
    const expected =
      Buffer.byteLength("abc") + Buffer.byteLength("title1") + Buffer.byteLength("https://example.com/img1.png") +
      Buffer.byteLength("defgh") + Buffer.byteLength("title2") + Buffer.byteLength("https://example.com/img2.png");
    expect(used).toBe(expected);
  });

  it("rejects prompt creation with 413 STORAGE_QUOTA_EXCEEDED when quota is exceeded", async () => {
    process.env.STORAGE_QUOTA_BYTES_PER_CREATOR = "100"; // Tiny 100-byte quota

    const user = { _id: "user123", walletAddress: "gcreator" };
    (User.findOne as jest.Mock).mockResolvedValue(user);

    // Existing prompt already using 90 bytes
    (Prompt.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue([
        { content: "a".repeat(80), title: "t", image: "https://img" },
      ]),
    });

    const req = httpMocks.createRequest({
      method: "POST",
      url: "/api/prompts",
      body: {
        walletAddress: "gcreator",
        title: "New Prompt",
        content: "This content is too large for remaining quota",
        image: "https://example.com/image.png",
        price: 10,
        category: "Art",
      },
    });
    const res = httpMocks.createResponse();

    await CreatePrompt(req, res);

    expect(res.statusCode).toBe(413);
    const data = res._getJSONData();
    expect(data.code).toBe("STORAGE_QUOTA_EXCEEDED");
  });

  it("returns creator storage quota breakdown via GetCreatorStorageQuota", async () => {
    process.env.STORAGE_QUOTA_BYTES_PER_CREATOR = "1000";

    const user = { _id: "user123", walletAddress: "gcreator" };
    (User.findOne as jest.Mock).mockResolvedValue(user);

    (Prompt.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockResolvedValue([
        { content: "a".repeat(200), title: "t", image: "https://img" },
      ]),
    });

    const req = httpMocks.createRequest({
      method: "GET",
      url: "/api/prompts/creator/gcreator/quota",
      params: { walletAddress: "gcreator" },
    });
    const res = httpMocks.createResponse();

    await GetCreatorStorageQuota(req, res);

    expect(res.statusCode).toBe(200);
    const data = res._getJSONData();
    expect(data.walletAddress).toBe("gcreator");
    expect(data.quotaBytes).toBe(1000);
    expect(data.usedBytes).toBeGreaterThan(200);
    expect(data.remainingBytes).toBe(1000 - data.usedBytes);
    expect(data.usagePercentage).toBeGreaterThan(20);
  });
});

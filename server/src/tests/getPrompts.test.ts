import httpMocks from "node-mocks-http";
import { GetPrompts } from "../controllers/controllers";
import connectDb from "../db/connectDb";
import { searchMarketplace } from "../services/marketplaceIndexService";

jest.mock("../db/connectDb");
jest.mock("../services/marketplaceIndexService", () => {
  const actual = jest.requireActual("../services/marketplaceIndexService");
  return { ...actual, searchMarketplace: jest.fn() };
});
jest.mock("../models/User");
jest.mock("../models/Prompt");
jest.mock("../services/cacheService");

describe("GetPrompts (indexer-backed marketplace list)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (connectDb as jest.Mock).mockResolvedValue(true);
  });

  function makeReq(url: string) {
    return httpMocks.createRequest({ method: "GET", url });
  }

  it("delegates to the indexer read model with parsed query params", async () => {
    const page = {
      items: [{ _id: "p1" }],
      total: 1,
      page: 1,
      limit: 24,
      totalPages: 1,
      nextCursor: null,
      hasNext: false,
      cached: false,
    };
    (searchMarketplace as jest.Mock).mockResolvedValue(page);

    const req = makeReq("http://localhost/api/prompts?category=Programming&page=2&sort=price_desc&search=ai");
    const res = httpMocks.createResponse();
    await GetPrompts(req, res);

    expect(searchMarketplace).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "Programming",
        page: 2,
        sort: "price_desc",
        search: "ai",
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res._getJSONData()).toEqual(page);
  });

  it("returns a paginated envelope (not a bare array) so clients can page", async () => {
    (searchMarketplace as jest.Mock).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 24,
      totalPages: 0,
      nextCursor: null,
      hasNext: false,
      cached: false,
    });

    const req = makeReq("http://localhost/api/prompts");
    const res = httpMocks.createResponse();
    await GetPrompts(req, res);

    const body = res._getJSONData();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("nextCursor");
  });
});

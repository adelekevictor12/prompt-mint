// @vitest-environment node

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { withObservability } from "./wrapper";

describe("withObservability wrapper security headers", () => {
  let mockReq: any;
  let mockRes: any;
  let mockHandler: any;

  beforeEach(() => {
    mockReq = {
      method: "GET",
      url: "/api/test",
      headers: {
        "x-forwarded-for": "127.0.0.1",
      },
      socket: {
        remoteAddress: "127.0.0.1",
      },
      secure: false,
    };
    mockRes = {
      setHeader: vi.fn(),
      statusCode: 200,
      writableEnded: false,
      status: vi.fn(function(this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function(this: any) {
        this.writableEnded = true;
        return this;
      }),
    };
    mockHandler = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should set X-Content-Type-Options to nosniff", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
  });

  it("should set X-Frame-Options to DENY", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
  });

  it("should set X-XSS-Protection", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-XSS-Protection", "1; mode=block");
  });

  it("should set Referrer-Policy", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  it("should set Permissions-Policy", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  });

  it("should set Content-Security-Policy for API endpoints", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'"
    );
  });

  it("should NOT set HSTS in development", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    const hstsCall = mockRes.setHeader.mock.calls.find((call: any[]) => call[0] === "Strict-Transport-Security");
    expect(hstsCall).toBeUndefined();
    
    process.env.NODE_ENV = originalEnv;
  });

  it("should NOT set HSTS in production without HTTPS", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    mockReq.secure = false;
    mockReq.headers["x-forwarded-proto"] = "http";
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    const hstsCall = mockRes.setHeader.mock.calls.find((call: any[]) => call[0] === "Strict-Transport-Security");
    expect(hstsCall).toBeUndefined();
    
    process.env.NODE_ENV = originalEnv;
  });

  it("should set HSTS in production with HTTPS via x-forwarded-proto", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    mockReq.headers["x-forwarded-proto"] = "https";
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
    
    process.env.NODE_ENV = originalEnv;
  });

  it("should set HSTS in production with HTTPS via req.secure", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    mockReq.secure = true;
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
    
    process.env.NODE_ENV = originalEnv;
  });

  it("should set security headers even when handler throws error", async () => {
    mockHandler.mockRejectedValue(new Error("Test error"));
    mockRes.writableEnded = false;
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    // Should still set security headers
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(mockRes.setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
  });

  it("should set security headers before handler execution", async () => {
    let headersSetBeforeHandler = false;
    
    mockHandler.mockImplementation(() => {
      headersSetBeforeHandler = mockRes.setHeader.mock.calls.some(
        (call: any[]) => call[0] === "X-Content-Type-Options"
      );
    });
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    expect(headersSetBeforeHandler).toBe(true);
  });

  it("should set all expected security headers on success", async () => {
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    const expectedHeaders = [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ];
    
    expectedHeaders.forEach(header => {
      const call = mockRes.setHeader.mock.calls.find((c: any[]) => c[0] === header);
      expect(call).toBeDefined();
    });
  });

  it("should set all expected security headers on error", async () => {
    mockHandler.mockRejectedValue(new Error("Test error"));
    mockRes.writableEnded = false;
    
    const wrappedHandler = withObservability(mockHandler, "test");
    await wrappedHandler(mockReq, mockRes);
    
    const expectedHeaders = [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
      "Referrer-Policy",
      "Permissions-Policy",
      "Content-Security-Policy",
    ];
    
    expectedHeaders.forEach(header => {
      const call = mockRes.setHeader.mock.calls.find((c: any[]) => c[0] === header);
      expect(call).toBeDefined();
    });
  });
});

import { serverMetrics } from "../services/serverMetrics";
import { metricsMiddleware } from "../middleware/metricsMiddleware";
import type { Request, Response } from "express";

describe("serverMetrics service", () => {
  beforeEach(() => {
    serverMetrics._resetForTests();
  });

  it("accumulates counter metrics and exports prometheus format", () => {
    serverMetrics.emit("http_requests_total", 1, { method: "GET", route: "/api/prompts", status: "200" });
    serverMetrics.emit("http_requests_total", 2, { method: "GET", route: "/api/prompts", status: "200" });

    const prometheus = serverMetrics.toPrometheus();
    expect(prometheus).toContain("# PromptMint server metrics");
    expect(prometheus).toContain('http_requests_total{method="GET",route="/api/prompts",status="200"} 3');
  });

  it("sets gauge metrics for latency and instantaneous metrics", () => {
    serverMetrics.emit("http_request_duration_ms", 45.5, { method: "POST", route: "/api/prompts" });
    serverMetrics.emit("http_request_duration_ms", 12.3, { method: "POST", route: "/api/prompts" });

    const prometheus = serverMetrics.toPrometheus();
    expect(prometheus).toContain('http_request_duration_ms{method="POST",route="/api/prompts"} 12.3');
  });

  it("tracks server errors total", () => {
    serverMetrics.emit("http_server_errors_total", 1, { method: "GET", route: "/api/prompts" });

    const prometheus = serverMetrics.toPrometheus();
    expect(prometheus).toContain('http_server_errors_total{method="GET",route="/api/prompts"} 1');
  });

  it("metricsMiddleware records metrics on response finish", (done) => {
    const req = {
      method: "GET",
      path: "/api/prompts/12345678",
      url: "/api/prompts/12345678",
    } as unknown as Request;

    let finishCallback: () => void = () => {};
    const res = {
      statusCode: 200,
      once: (event: string, cb: () => void) => {
        if (event === "finish") finishCallback = cb;
      },
    } as unknown as Response;

    const next = () => {
      // Simulate response finish
      finishCallback();
      const prometheus = serverMetrics.toPrometheus();
      expect(prometheus).toContain('http_requests_total{method="GET",route="/api/prompts/:id",status="200"} 1');
      expect(prometheus).toContain('http_request_duration_ms{method="GET",route="/api/prompts/:id"}');
      done();
    };

    metricsMiddleware(req, res, next);
  });
});

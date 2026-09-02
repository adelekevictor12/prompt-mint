import { NextFunction, Request, Response } from "express";
import { serverMetrics } from "../services/serverMetrics";

// Normalize a request path to a route template so high-cardinality IDs don't
// explode the metric series (e.g. "/api/prompts/60c72b2f9b1d8b2bad74671a" -> "/api/prompts/:id").
function routeTemplate(req: Request): string {
  const base = req.route?.path ?? req.path ?? req.url;
  return base
    .split("/")
    .map((seg) => (/^[0-9a-fA-F]{8,}$/.test(seg) || /^\d+$/.test(seg) ? ":id" : seg))
    .join("/");
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // Don't instrument the metrics endpoint itself
  if (req.path.startsWith("/api/metrics") || req.path === "/metrics") {
    return next();
  }

  const start = process.hrtime.bigint();
  const method = req.method;

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = routeTemplate(req);
    const status = res.statusCode;

    serverMetrics.emit("http_requests_total", 1, {
      method,
      route,
      status: String(status),
    });
    serverMetrics.emit("http_request_duration_ms", durationMs, { method, route });
    if (status >= 500) {
      serverMetrics.emit("http_server_errors_total", 1, { method, route });
    }
  });

  next();
}

import "dotenv/config";
import "./instrumentation";
import express from "express";
import cors from "cors";
import { buildCorsOptions } from "./config/cors";
import { securityHeaders } from "./middleware/securityHeaders";
import { TestPromptProxy } from "./controllers/controllers";
import { proxyrouter } from "./routes/proxyRoutes";
import { promptRouter } from "./routes/promptRoutes";
import { userRouter } from "./routes/userRoutes";
import { chatRouter } from "./routes/chatRoutes";
import { webhookRouter } from "./routes/webhookRoutes";
import { versioningRouter } from "./routes/versioningRoutes";
import { governanceRouter } from "./routes/governanceRoutes"; // Issue #113
import { appealRouter } from "./routes/appealRoutes";
import { robotsRouter } from "./routes/robotsRoutes";
import { licenseTermsRouter } from "./routes/licenseTermsRoutes";
import { runBackup, getBackupHealth } from "./services/backupService";
import { runRestoreDrill } from "./services/restoreService";
import { blobRouter } from "./routes/blobRoutes";
import { IndexerState } from "./models/IndexerState"; 
import creatorReputationHandler from "./controllers/creatorReputationController";
import cron from "node-cron";
import { JSON_BODY_LIMIT, jsonBodyTooLargeHandler } from "./middleware/bodySizeLimit";
import { docsRouter } from "./routes/docsRoutes";
import { metricsRouter } from "./routes/metricsRoutes";
import { metricsMiddleware } from "./middleware/metricsMiddleware";
import { idempotency } from "./middleware/idempotency";
import { versionNegotiation } from "./middleware/versioning";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { closeDb } from "./db/connectDb";
import { closeRedis } from "./lib/redisConnection";
import { flushPendingWebhooks } from "./services/webhookDispatcher";
import { closeCache } from "./services/cacheService";
import { shutdownTelemetry } from "./instrumentation";

const app = express();

let acceptingRequests = true;
app.use((req, res, next) => {
  if (acceptingRequests) return next();
  res.setHeader("Connection", "close");
  res.status(503).json({ error: "Server is shutting down. Please retry shortly." });
});

const port = 5000;

// Hardened CORS — only allowlisted origins receive CORS headers
app.use(cors(buildCorsOptions()));

// CORS error handler: return clean 403 JSON instead of Express default
app.use((err: any, req: any, res: any, next: any) => {
  if (err && typeof err.message === "string" && err.message.startsWith("CORS:")) {
    res.status(403).json({ error: "Forbidden", code: "CORS_FORBIDDEN" });
    return;
  }
  next(err);
});

// Hardened security headers: CSP, HSTS, X-Frame-Options, etc.
app.use(securityHeaders);

app.use(express.json({ limit: JSON_BODY_LIMIT }));

// Body-parser throws a 413 "entity.too.large" error before any route runs;
// surface it as a clean JSON response instead of an HTML stack trace.
app.use(jsonBodyTooLargeHandler);

// Replays the cached response for a retried state-changing request that
// carries a matching Idempotency-Key header; a no-op for every other
// request, so this is safe to apply ahead of all routers. (Issue #89)
app.use(idempotency());

// API version negotiation: resolves version from URL path, header, or query param.
// Sets X-API-Version and Deprecation headers. (#209)
app.use(versionNegotiation);

app.use(robotsRouter);

// #448 - Prometheus/Grafana metrics collection and export
app.use(metricsMiddleware);

app.use("/api/docs", docsRouter);
app.use("/api/metrics", metricsRouter);
app.use("/metrics", metricsRouter);

app.use("/api/improve-proxy", proxyrouter);

app.use("/api/prompts", promptRouter);

app.use("/api/user", userRouter);

app.use("/api/chat", chatRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/versions", versioningRouter);
app.use("/api/governance", governanceRouter); // Issue #113
app.use("/api/blobs", blobRouter);
app.get("/api/creators/reputation", creatorReputationHandler);

app.post("/api/test-prompt", TestPromptProxy);

app.get("/health", async (req, res) => {
  const [state, backupHealth] = await Promise.all([
    IndexerState.findOne({ key: "prompt_hash_contract" }),
    getBackupHealth(),
  ]);
  res.json({
    status: "ok",
    indexer: {
      lastProcessedLedger: state?.lastIndexedLedger || 0,
      timestamp: new Date(),
    },
    backup: backupHealth,
  });
});

export const server = app.listen(port, () => {
  console.log(`Listening on port ${port}`);

  // STARTS THE INDEXER HERE
  // startIndexer().catch((err: any) => {
  //   console.error("Failed to start Soroban Indexer:", err);
  // });

  // DAILY AUTOMATED BACKUP — runs immediately on startup then every 24 h.
  // Use BACKUP_S3_BUCKET env var to enable; silently skips if not configured.
  if (process.env.BACKUP_S3_BUCKET) {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const triggerBackup = () => {
      runBackup().catch((err) => {
        console.error("[backup] Scheduled backup failed:", err?.message ?? err);
      });
    };
    // Run once on startup, then on a 24-hour interval.
    triggerBackup();
    setInterval(triggerBackup, TWENTY_FOUR_HOURS);
    console.log("[backup] Daily backup scheduler started.");
  }

  // Run the restore verification independently of backup export configuration.
  if (process.env.ENABLE_RESTORE_DRILL === "true") {
    const schedule = process.env.RESTORE_DRILL_CRON || "0 3 * * *";
    cron.schedule(schedule, () => {
      runRestoreDrill().catch((err: unknown) => {
        console.error("[restore] Scheduled drill failed:", err instanceof Error ? err.message : err);
      });
    });
    console.log(`[restore] Restore drill scheduler started (${schedule}).`);
  }
});

const sockets = new Set<Socket>();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

function waitForServerClose(httpServer: Server, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(closed);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    httpServer.close((err) => finish(!err));
    httpServer.closeIdleConnections?.();
  });
}

let shutdownPromise: Promise<void> | null = null;

/** Stop traffic, drain active work for up to 30 seconds, then close pools. */
export function gracefulShutdown(timeoutMs = 30_000): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    acceptingRequests = false;
    const deadline = Date.now() + timeoutMs;
    console.log("[shutdown] Draining HTTP connections and webhook deliveries.");
    const httpDrained = await waitForServerClose(server, Math.max(0, deadline - Date.now()));
    const webhooksFlushed = await flushPendingWebhooks(Math.max(0, deadline - Date.now()));
    if (!httpDrained || !webhooksFlushed) {
      console.warn("[shutdown] Drain deadline reached; closing remaining sockets.");
      for (const socket of sockets) socket.destroy();
    }
    await Promise.allSettled([closeDb(), closeRedis(), closeCache(), shutdownTelemetry()]);
    console.log("[shutdown] Database and Redis connections closed.");
  })();
  return shutdownPromise;
}

function handleSignal(signal: "SIGTERM" | "SIGINT") {
  console.log(`[shutdown] Received ${signal}.`);
  void gracefulShutdown().finally(() => process.exit(0));
}

process.once("SIGTERM", () => handleSignal("SIGTERM"));
process.once("SIGINT", () => handleSignal("SIGINT"));

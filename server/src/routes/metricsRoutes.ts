import { Router } from "express";
import { serverMetrics } from "../services/serverMetrics";

export const metricsRouter = Router();

metricsRouter.get("/", (_req, res) => {
  const body = serverMetrics.toPrometheus();
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(body);
});

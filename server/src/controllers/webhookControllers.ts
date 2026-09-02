import { randomBytes } from "crypto";
import connectDb from "../db/connectDb";
import WebhookSubscription from "../models/WebhookSubscription";
import WebhookDelivery from "../models/WebhookDelivery";
import WebhookDeadLetter from "../models/WebhookDeadLetter";
import { AppError } from "../lib/AppError";
import { asyncRoute } from "../lib/asyncRoute";
import { validateWebhookUrl } from "../lib/validateWebhookUrl";
import { sendTestEvent, replayDeadLetter } from "../services/webhookDispatcher";
import { isValidAdminToken } from "../services/adminAuth";
import { recordAuditEvent } from "../services/auditTrail";
import { validateBody } from "../middleware/validateRequest";
import { z } from "zod";

/**
 * Real contract events a creator can subscribe a webhook to (issue #23:
 * "listing sales, transfers, disputes, and version updates").
 */
const ALLOWED_EVENTS = [
  "PromptCreated", // new listing created
  "PromptPurchased", // listing sales
  "PromptPriceUpdated", // price changes
  "LicenseTransferred", // transfers
  "DisputeOpened", // disputes
  "DisputeResolved", // disputes
  "EncryptionRotated", // version updates
];

// #211 — Zod schemas for webhook request validation
const RegisterWebhookBody = z.object({
  walletAddress: z.string().trim().min(1, "walletAddress is required."),
  url: z.string().trim().url("url must be a valid URL."),
  events: z.array(z.string()).optional(),
}).strict();

const WalletAddressBody = z.object({
  walletAddress: z.string().trim().min(1, "walletAddress is required."),
}).strict();

export const validateRegisterWebhook = validateBody(RegisterWebhookBody);

export const RegisterWebhook = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress, url, events } = req.body;

  const urlCheck = await validateWebhookUrl(url);
  if (!urlCheck.valid) {
    throw new AppError(urlCheck.reason ?? "url is not allowed.", 400, "INVALID_INPUT");
  }

  const secret = randomBytes(32).toString("hex");
  const resolvedEvents = Array.isArray(events)
    ? events.filter((e: string) => ALLOWED_EVENTS.includes(e))
    : ["PromptPurchased"];

  const existing = await WebhookSubscription.findOne({
    walletAddress: walletAddress.toLowerCase(),
  });

  if (existing) {
    existing.url = url;
    existing.events = resolvedEvents;
    existing.active = true;
    existing.failureCount = 0;
    await existing.save();
    res.status(200).json({ message: "Webhook updated.", id: existing._id, secret });
    return;
  }

  const sub = new WebhookSubscription({
    walletAddress: walletAddress.toLowerCase(),
    url,
    secret,
    events: resolvedEvents,
  });
  await sub.save();

  res.status(201).json({ message: "Webhook registered.", id: sub._id, secret });
});

export const GetWebhook = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress } = req.query;

  if (!walletAddress) {
    throw new AppError("walletAddress query param is required.", 400, "MISSING_FIELDS");
  }

  const sub = await WebhookSubscription.findOne({
    walletAddress: String(walletAddress).toLowerCase(),
  }).select("-secret");

  if (!sub) {
    throw new AppError("No webhook registered for this wallet.", 404, "NOT_FOUND");
  }

  res.json(sub);
});

export const DeleteWebhook = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress } = req.body;

  if (!walletAddress) {
    throw new AppError("walletAddress is required.", 400, "MISSING_FIELDS");
  }

  await WebhookSubscription.deleteOne({ walletAddress: walletAddress.toLowerCase() });
  res.status(200).json({ message: "Webhook removed." });
});

/** Rotates the HMAC secret for a wallet's webhook. The old secret stops working immediately. */
export const RotateWebhookSecret = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress } = req.body;

  if (!walletAddress) {
    throw new AppError("walletAddress is required.", 400, "MISSING_FIELDS");
  }

  const sub = await WebhookSubscription.findOne({
    walletAddress: walletAddress.toLowerCase(),
  });
  if (!sub) {
    throw new AppError("No webhook registered for this wallet.", 404, "NOT_FOUND");
  }

  const secret = randomBytes(32).toString("hex");
  sub.secret = secret;
  await sub.save();

  res.status(200).json({ message: "Secret rotated.", secret });
});

/** Sends a synthetic test event to the registered endpoint and reports the outcome inline. */
export const TestWebhook = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress } = req.body;

  if (!walletAddress) {
    throw new AppError("walletAddress is required.", 400, "MISSING_FIELDS");
  }

  const sub = await WebhookSubscription.findOne({
    walletAddress: walletAddress.toLowerCase(),
  });
  if (!sub) {
    throw new AppError("No webhook registered for this wallet.", 404, "NOT_FOUND");
  }

  const result = await sendTestEvent(sub);
  res.status(200).json(result);
});

/** Lists recent delivery attempts for a wallet's webhook so creators can inspect history. */
export const GetWebhookDeliveries = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress } = req.query;

  if (!walletAddress) {
    throw new AppError("walletAddress query param is required.", 400, "MISSING_FIELDS");
  }

  const sub = await WebhookSubscription.findOne({
    walletAddress: String(walletAddress).toLowerCase(),
  });
  if (!sub) {
    throw new AppError("No webhook registered for this wallet.", 404, "NOT_FOUND");
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const deliveries = await WebhookDelivery.find({ subscriptionId: sub._id })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json(deliveries);
});

/**
 * Lists events that exhausted every delivery retry for a wallet's webhook
 * (issue #97), so a creator can see which contract events their endpoint
 * never actually received and decide whether to replay them.
 */
export const GetWebhookDeadLetters = asyncRoute(async (req, res) => {
  await connectDb();
  const { walletAddress } = req.query;

  if (!walletAddress) {
    throw new AppError("walletAddress query param is required.", 400, "MISSING_FIELDS");
  }

  const sub = await WebhookSubscription.findOne({
    walletAddress: String(walletAddress).toLowerCase(),
  });
  if (!sub) {
    throw new AppError("No webhook registered for this wallet.", 404, "NOT_FOUND");
  }

  const onlyUnresolved = req.query.resolved !== "true";
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const deadLetters = await WebhookDeadLetter.find({
    subscriptionId: sub._id,
    ...(onlyUnresolved ? { resolved: false } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  res.json(deadLetters);
});

/**
 * Re-attempts delivery of a single dead-lettered event. Admin-token gated
 * (rather than wallet-scoped like the other webhook endpoints) since it
 * triggers an outbound HTTP call on demand, same trust boundary as the
 * other admin-only actions in this codebase (see GetPromptReports).
 */
export const ReplayWebhookDeadLetter = asyncRoute(async (req, res) => {
  await connectDb();

  if (!isValidAdminToken(req.headers.authorization, process.env.ADMIN_API_TOKEN)) {
    void recordAuditEvent({ action: "auth_failure", result: "failure", reason: "invalid_admin_token", clientIp: req.ip });
    throw new AppError("Unauthorized: a valid admin token is required", 401);
  }

  const { id } = req.params;
  if (!id) {
    throw new AppError("Dead letter id is required.", 400, "MISSING_FIELDS");
  }

  try {
    const result = await replayDeadLetter(id);
    void recordAuditEvent({ action: "admin_action", result: "success", reason: "replay_webhook_dead_letter", clientIp: req.ip, metadata: { deadLetterId: id } });
    res.status(200).json(result);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : "Replay failed.", 404, "NOT_FOUND");
  }
});

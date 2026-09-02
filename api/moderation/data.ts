import {
  buildModeratorAuthMessage,
  verifyChallengeSignature,
} from "../../src/lib/auth/challenge";

export type ModerationAction =
  | "review_removed"
  | "review_approved"
  | "user_warned"
  | "report_resolved"
  | "report_dismissed"
  | "prompt_takedown"
  | "prompt_reinstated";

export type ModerationTargetType = "review" | "user" | "report" | "prompt";

export interface ModerationLogEntry {
  id: string;
  action: ModerationAction;
  moderatorAddress: string;
  targetId: string;
  targetType: ModerationTargetType;
  reason: string;
  details?: string;
  createdAt: number;
}

// ── Abuse reports ─────────────────────────────────────────────────────────────

export type ReportTargetType = "prompt" | "review" | "user";
export type ReportStatus = "pending" | "under_review" | "resolved" | "dismissed";
export type ReportReason =
  | "copyright"
  | "spam"
  | "inappropriate"
  | "scam"
  | "misinformation"
  | "other";

export interface AbuseReport {
  id: string;
  reporterAddress: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  createdAt: number;
  updatedAt: number;
  resolvedBy?: string;
  resolution?: string;
}

const reports: AbuseReport[] = [];

export const REPORT_REASONS: ReportReason[] = [
  "copyright",
  "spam",
  "inappropriate",
  "scam",
  "misinformation",
  "other",
];

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addReport(
  entry: Omit<AbuseReport, "id" | "createdAt" | "updatedAt" | "status">,
): AbuseReport {
  const now = Date.now();
  const stored: AbuseReport = {
    ...entry,
    id: generateId("rep"),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  reports.push(stored);
  return stored;
}

export function getReportById(id: string): AbuseReport | undefined {
  return reports.find((report) => report.id === id);
}

export interface ReportQuery {
  status?: ReportStatus;
  targetType?: ReportTargetType;
  reason?: ReportReason;
  reporterAddress?: string;
  search?: string;
  since?: number;
}

export function getReports(query: ReportQuery = {}): AbuseReport[] {
  let filtered = [...reports];
  if (query.status) filtered = filtered.filter((r) => r.status === query.status);
  if (query.targetType) filtered = filtered.filter((r) => r.targetType === query.targetType);
  if (query.reason) filtered = filtered.filter((r) => r.reason === query.reason);
  if (query.reporterAddress)
    filtered = filtered.filter(
      (r) => r.reporterAddress.toLowerCase() === query.reporterAddress!.toLowerCase(),
    );
  if (query.since) filtered = filtered.filter((r) => r.createdAt >= query.since!);
  if (query.search) {
    const needle = query.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.targetId.toLowerCase().includes(needle) ||
        r.details?.toLowerCase().includes(needle) ||
        r.reporterAddress.toLowerCase().includes(needle),
    );
  }
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  return filtered;
}

export function hasOpenReport(
  reporterAddress: string,
  targetType: ReportTargetType,
  targetId: string,
): boolean {
  return reports.some(
    (r) =>
      r.reporterAddress.toLowerCase() === reporterAddress.toLowerCase() &&
      r.targetType === targetType &&
      r.targetId === targetId &&
      r.status !== "resolved" &&
      r.status !== "dismissed",
  );
}

export function updateReportStatus(
  id: string,
  status: ReportStatus,
  options: { resolvedBy?: string; resolution?: string; now?: number } = {},
): AbuseReport | undefined {
  const report = getReportById(id);
  if (!report) return undefined;
  report.status = status;
  report.updatedAt = options.now ?? Date.now();
  if (options.resolvedBy) report.resolvedBy = options.resolvedBy;
  if (options.resolution) report.resolution = options.resolution;
  return report;
}

// ── Prompt takedown state ────────────────────────────────────────────────────

export type PromptModerationStatus = "active" | "taken_down";

export interface PromptModerationState {
  promptId: string;
  status: PromptModerationStatus;
  reason?: string;
  updatedAt: number;
  updatedBy?: string;
}

const promptStates = new Map<string, PromptModerationState>();

export function getPromptModerationState(promptId: string): PromptModerationState {
  return (
    promptStates.get(promptId) ?? {
      promptId,
      status: "active",
      updatedAt: 0,
    }
  );
}

export function setPromptModerationState(
  promptId: string,
  status: PromptModerationStatus,
  options: { reason?: string; updatedBy?: string; now?: number } = {},
): PromptModerationState {
  const state: PromptModerationState = {
    promptId,
    status,
    reason: options.reason,
    updatedAt: options.now ?? Date.now(),
    updatedBy: options.updatedBy,
  };
  promptStates.set(promptId, state);
  return state;
}

export function isPromptTakenDown(promptId: string): boolean {
  return getPromptModerationState(promptId).status === "taken_down";
}

const logs: ModerationLogEntry[] = [];

export function addModerationLog(entry: Omit<ModerationLogEntry, "id" | "createdAt">): ModerationLogEntry {
  const stored = { ...entry, id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() };
  logs.push(stored);
  return stored;
}

export function getModerationLogs(): ModerationLogEntry[] {
  return logs;
}

export function isAuthorizedModerator(address: string): boolean {
  const configured = (process.env.MODERATOR_ADDRESSES ?? "")
    .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  // Failing closed prevents an unconfigured deployment from granting moderation authority.
  return configured.length > 0 && configured.includes(address.toLowerCase());
}

// ── Moderator request authentication ─────────────────────────────────────────
//
// Knowing a moderator's public wallet address is not proof of controlling it —
// Stellar addresses are frequently public (attached to reviews, transactions,
// etc). Every moderation endpoint therefore requires a signature, proving the
// caller holds the matching private key, over a message that is scoped to a
// specific purpose (so a signature captured for one moderation endpoint can't
// be replayed against another) and a timestamp (so it can't be replayed after
// it expires).

const MODERATOR_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export interface ModeratorAuthParams {
  address?: string;
  timestamp?: number;
  signature?: string;
  purpose: string;
  now?: number;
}

export interface ModeratorAuthResult {
  ok: boolean;
  status: number;
  error?: string;
}

export function verifyModeratorAuth({
  address,
  timestamp,
  signature,
  purpose,
  now = Date.now(),
}: ModeratorAuthParams): ModeratorAuthResult {
  if (!address) {
    return { ok: false, status: 401, error: "Moderator address is required" };
  }

  if (!isAuthorizedModerator(address)) {
    return { ok: false, status: 403, error: "Unauthorized: Only authorized moderators can perform this action" };
  }

  if (!timestamp || !signature) {
    return { ok: false, status: 401, error: "Moderator signature is required" };
  }

  if (Math.abs(now - timestamp) > MODERATOR_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, status: 401, error: "Moderator signature has expired" };
  }

  const message = buildModeratorAuthMessage(address, purpose, timestamp);
  if (!verifyChallengeSignature(address, message, signature)) {
    return { ok: false, status: 401, error: "Invalid moderator signature" };
  }

  return { ok: true, status: 200 };
}

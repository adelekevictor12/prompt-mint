import { negotiateVersion } from "../../src/lib/api/versionGuard";
import { withVersion } from "../../src/lib/api/payloadVersion";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import {
  getReports,
  verifyModeratorAuth,
  REPORT_REASONS,
  type AbuseReport,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "./data";

function isReportStatus(value: unknown): value is ReportStatus {
  return value === "pending" || value === "under_review" || value === "resolved" || value === "dismissed";
}

function isReportTargetType(value: unknown): value is ReportTargetType {
  return value === "prompt" || value === "review" || value === "user";
}

function isReportReason(value: unknown): value is ReportReason {
  return REPORT_REASONS.includes(value as ReportReason);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const version = negotiateVersion(req, res);
  if (!version) return;

  const moderatorAddress = (req.query.moderatorAddress as string) ?? "";
  const moderatorTimestamp = req.query.moderatorTimestamp
    ? parseInt(req.query.moderatorTimestamp as string, 10)
    : undefined;
  const moderatorSignature = (req.query.moderatorSignature as string) ?? undefined;

  if (!moderatorAddress) {
    res.status(401).json({ apiVersion: version, error: "Moderator address is required" });
    return;
  }

  const auth = verifyModeratorAuth({
    address: moderatorAddress,
    timestamp: moderatorTimestamp,
    signature: moderatorSignature,
    purpose: "moderation-queue",
  });
  if (!auth.ok) {
    res.status(auth.status).json({ apiVersion: version, error: auth.error });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

  const statusParam = req.query.status as string;
  const targetTypeParam = req.query.targetType as string;
  const reasonParam = req.query.reason as string;
  const search = (req.query.search as string) ?? "";
  const since = req.query.since ? parseInt(req.query.since as string, 10) : 0;

  try {
    const filtered = getReports({
      status: statusParam && isReportStatus(statusParam) ? statusParam : undefined,
      targetType: targetTypeParam && isReportTargetType(targetTypeParam) ? targetTypeParam : undefined,
      reason: reasonParam && isReportReason(reasonParam) ? reasonParam : undefined,
      search: search || undefined,
      since: since || undefined,
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const entries: AbuseReport[] = filtered.slice(start, start + limit);

    res.status(200).json(
      withVersion(
        {
          entries,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasMore: page < totalPages,
          },
        },
        version,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch moderation queue";
    console.error("Moderation queue error:", message);
    res.status(500).json(apiError(ErrorCode.TEMPORARY_FAILURE, message, undefined, version));
  }
}

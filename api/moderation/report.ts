import { withBodySizeLimit } from "../../src/lib/api/bodySizeLimit";
import { negotiateVersion } from "../../src/lib/api/versionGuard";
import { withVersion } from "../../src/lib/api/payloadVersion";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import {
  addReport,
  hasOpenReport,
  REPORT_REASONS,
  type AbuseReport,
  type ReportReason,
  type ReportTargetType,
} from "./data";
import { verifyReportAuth } from "../../src/lib/auth/challenge";

const MAX_DETAILS_LENGTH = 2000;

interface ReportSubmission {
  reporterAddress?: string;
  reporterTimestamp?: number;
  reporterSignature?: string;
  targetType?: ReportTargetType;
  targetId?: string;
  reason?: ReportReason;
  details?: string;
}

function isReportTargetType(value: unknown): value is ReportTargetType {
  return value === "prompt" || value === "review" || value === "user";
}

function isReportReason(value: unknown): value is ReportReason {
  return REPORT_REASONS.includes(value as ReportReason);
}

async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const version = negotiateVersion(req, res);
  if (!version) return;

  const body = (req.body ?? {}) as ReportSubmission;
  const {
    reporterAddress,
    reporterTimestamp,
    reporterSignature,
    targetType,
    targetId,
    reason,
    details,
  } = body;

  if (!isReportTargetType(targetType) || !targetId || !targetId.trim()) {
    res.status(400).json(
      apiError(ErrorCode.MISSING_FIELDS, "A valid report target (type and id) is required", undefined, version),
    );
    return;
  }

  if (!isReportReason(reason)) {
    res.status(400).json(
      apiError(ErrorCode.INVALID_INPUT, "A valid report reason is required", undefined, version),
    );
    return;
  }

  const normalizedDetails = details?.trim();
  if (normalizedDetails && normalizedDetails.length > MAX_DETAILS_LENGTH) {
    res.status(400).json(
      apiError(
        ErrorCode.INVALID_INPUT,
        `Report details must not exceed ${MAX_DETAILS_LENGTH} characters`,
        undefined,
        version,
      ),
    );
    return;
  }

  if (!reporterAddress || !reporterAddress.trim()) {
    res.status(401).json(
      apiError(ErrorCode.MISSING_FIELDS, "A connected wallet is required to file a report", undefined, version),
    );
    return;
  }

  const auth = verifyReportAuth({
    address: reporterAddress.trim(),
    targetType,
    targetId: targetId.trim(),
    timestamp: reporterTimestamp,
    signature: reporterSignature,
  });
  if (!auth.ok) {
    res.status(auth.status).json({ apiVersion: version, error: auth.error });
    return;
  }

  if (hasOpenReport(reporterAddress.trim(), targetType, targetId.trim())) {
    res.status(409).json(
      withVersion(
        { error: "You have already reported this item and it is still being reviewed" },
        version,
      ),
    );
    return;
  }

  try {
    const report = addReport({
      reporterAddress: reporterAddress.trim(),
      targetType,
      targetId: targetId.trim(),
      reason,
      details: normalizedDetails,
    });

    console.log(
      `✓ Abuse report ${report.id} filed by ${reporterAddress.slice(0, 8)}... for ${targetType} ${targetId}`,
    );

    const response: AbuseReport = { ...report };
    res.status(201).json(withVersion({ success: true, report: response }, version));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit report";
    console.error("Report submission error:", message);
    res.status(500).json(apiError(ErrorCode.TEMPORARY_FAILURE, message, undefined, version));
  }
}

export default withBodySizeLimit(handler);

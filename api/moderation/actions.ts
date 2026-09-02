import { findReviewById, updateReview } from "../reviews/data";
import {
  addModerationLog,
  getReportById,
  updateReportStatus,
  setPromptModerationState,
  verifyModeratorAuth,
} from "./data";
import { withBodySizeLimit } from "../../src/lib/api/bodySizeLimit";

type Action =
  | "review_removed"
  | "review_approved"
  | "user_warned"
  | "report_resolved"
  | "report_dismissed"
  | "prompt_takedown"
  | "prompt_reinstated";

type TargetType = "review" | "user" | "report" | "prompt";

interface BulkAction {
  action: Action;
  targetId: string;
  targetType: TargetType;
  reason: string;
  details?: string;
}

const VALID_ACTIONS: Action[] = [
  "review_removed",
  "review_approved",
  "user_warned",
  "report_resolved",
  "report_dismissed",
  "prompt_takedown",
  "prompt_reinstated",
];

const ACTION_TARGET: Record<Action, TargetType> = {
  review_removed: "review",
  review_approved: "review",
  user_warned: "user",
  report_resolved: "report",
  report_dismissed: "report",
  prompt_takedown: "prompt",
  prompt_reinstated: "prompt",
};

async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { moderatorAddress, moderatorTimestamp, moderatorSignature, confirmed, actions } = (req.body ?? {}) as {
    moderatorAddress?: string;
    moderatorTimestamp?: number;
    moderatorSignature?: string;
    confirmed?: boolean;
    actions?: BulkAction[];
  };

  const auth = verifyModeratorAuth({
    address: moderatorAddress,
    timestamp: moderatorTimestamp,
    signature: moderatorSignature,
    purpose: "moderation-action",
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (confirmed !== true) return res.status(400).json({ error: "Bulk actions require confirmed: true" });
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 50) return res.status(400).json({ error: "Provide between 1 and 50 actions" });

  const errors: Array<{ index: number; error: string }> = [];
  const applied = [];
  for (const [index, item] of actions.entries()) {
    if (
      !item ||
      !VALID_ACTIONS.includes(item.action) ||
      !item.targetId ||
      !item.reason?.trim() ||
      item.targetType !== ACTION_TARGET[item.action]
    ) {
      errors.push({ index, error: "Invalid action, target, or reason" });
      continue;
    }

    let ok = true;
    if (item.targetType === "review") {
      const review = findReviewById(item.targetId);
      if (!review) {
        errors.push({ index, error: "Review not found" });
        ok = false;
      } else {
        updateReview(review.promptId, review.id, {
          moderation: {
            status: item.action === "review_removed" ? "removed" : "approved",
            moderatorAddress: moderatorAddress ?? "",
            reason: item.reason.trim(),
            updatedAt: Date.now(),
          },
        });
      }
    } else if (item.targetType === "report") {
      const report = getReportById(item.targetId);
      if (!report) {
        errors.push({ index, error: "Report not found" });
        ok = false;
      } else {
        const status = item.action === "report_resolved" ? "resolved" : "dismissed";
        updateReportStatus(report.id, status, {
          resolvedBy: moderatorAddress ?? "",
          resolution: item.reason.trim(),
        });
      }
    } else if (item.targetType === "prompt") {
      const nextStatus = item.action === "prompt_takedown" ? "taken_down" : "active";
      setPromptModerationState(item.targetId, nextStatus, {
        reason: item.reason.trim(),
        updatedBy: moderatorAddress ?? "",
      });
    }

    if (ok) {
      applied.push(
        addModerationLog({
          action: item.action,
          targetId: item.targetId,
          targetType: item.targetType,
          reason: item.reason.trim(),
          details: item.details?.trim(),
          moderatorAddress: moderatorAddress ?? "",
        }),
      );
    }
  }
  return res.status(errors.length ? 207 : 200).json({ success: errors.length === 0, applied, errors });
}

export default withBodySizeLimit(handler);

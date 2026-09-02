import { negotiateVersion } from "../../src/lib/api/versionGuard";
import { withVersion } from "../../src/lib/api/payloadVersion";
import { apiError, ErrorCode } from "../../src/lib/api/errorCodes";
import { getPromptModerationState } from "./data";

/**
 * Public, unauthenticated endpoint that lets the frontend know whether a listing
 * has been taken down by a moderator. We intentionally only expose the boolean
 * state (and the reason category) — never moderator identity or audit detail.
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const version = negotiateVersion(req, res);
  if (!version) return;

  const promptId = (req.query.promptId as string) ?? "";
  if (!promptId || !promptId.trim()) {
    res.status(400).json(
      apiError(ErrorCode.MISSING_FIELDS, "promptId is required", undefined, version),
    );
    return;
  }

  try {
    const state = getPromptModerationState(promptId.trim());
    res.status(200).json(
      withVersion(
        {
          promptId: state.promptId,
          takenDown: state.status === "taken_down",
          reason: state.status === "taken_down" ? state.reason ?? null : null,
          updatedAt: state.updatedAt,
        },
        version,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch prompt status";
    console.error("Prompt status error:", message);
    res.status(500).json(apiError(ErrorCode.TEMPORARY_FAILURE, message, undefined, version));
  }
}

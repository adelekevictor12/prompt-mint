/**
 * Automated rollback on CI/deploy failure (#236).
 *
 * Pure orchestration: detect a failed production deploy, select the last
 * known-good version, revert, notify Slack/Discord, and open an incident ticket.
 * HTTP/platform I/O is injected so the flow is unit-testable without network.
 */

export const DEPLOY_WORKFLOW_NAMES = [
  "Deploy - Frontend to Vercel and Artifacts",
  "Deploy",
] as const;

export const ROLLBACK_PROTECTED_REFS = ["main", "refs/heads/main"] as const;

export type WorkflowConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "skipped"
  | "action_required"
  | "neutral"
  | "stale";

export type DeploymentState = "READY" | "ERROR" | "BUILDING" | "QUEUED" | "CANCELED";

export interface CiFailureEvent {
  workflowName: string;
  conclusion: string;
  runId: number;
  runUrl: string;
  sha: string;
  ref: string;
  actor: string;
  environment?: string;
}

export interface DeploymentRecord {
  id: string;
  sha: string;
  url?: string;
  createdAt: string;
  state: DeploymentState;
  production: boolean;
}

export interface NotificationPayload {
  channel: "slack" | "discord";
  title: string;
  text: string;
  severity: "critical" | "warning" | "info";
  fields: Record<string, string>;
  url?: string;
}

export interface IncidentTicketInput {
  title: string;
  body: string;
  labels: string[];
  severity: "SEV-1" | "SEV-2" | "SEV-3";
}

export interface IncidentTicketResult {
  url: string;
  number: number;
}

export type RollbackOutcome =
  | "rolled_back"
  | "incident_only"
  | "skipped";

export interface RollbackResult {
  outcome: RollbackOutcome;
  reason: string;
  failedSha: string;
  lastKnownGood?: DeploymentRecord;
  rolledBackTo?: string;
  incident?: IncidentTicketResult;
  notificationsSent: Array<"slack" | "discord">;
}

export interface RollbackDependencies {
  listProductionDeployments: () => Promise<DeploymentRecord[]>;
  // eslint-disable-next-line no-unused-vars
  rollbackTo: (deploymentId: string) => Promise<{ rolledBackTo: string }>;
  // eslint-disable-next-line no-unused-vars
  notify: (payload: NotificationPayload) => Promise<"slack" | "discord" | null>;
  // eslint-disable-next-line no-unused-vars
  createIncident: (ticket: IncidentTicketInput) => Promise<IncidentTicketResult>;
  now?: () => Date;
  dryRun?: boolean;
}

export function isProtectedRef(ref: string): boolean {
  const normalized = ref.replace(/^refs\/heads\//, "");
  return ROLLBACK_PROTECTED_REFS.some(
    (allowed) => allowed === ref || allowed === normalized || allowed.replace(/^refs\/heads\//, "") === normalized,
  );
}

export function isDeployWorkflow(workflowName: string): boolean {
  return DEPLOY_WORKFLOW_NAMES.some(
    (name) => name.toLowerCase() === workflowName.trim().toLowerCase(),
  );
}

/**
 * A rollback is warranted when a production deploy workflow failed or timed
 * out on a protected branch. Cancelled / skipped runs are not rollbacks.
 */
export function shouldTriggerRollback(event: CiFailureEvent): boolean {
  if (!isDeployWorkflow(event.workflowName)) return false;
  if (!isProtectedRef(event.ref)) return false;
  if (event.environment && event.environment !== "production") return false;
  return event.conclusion === "failure" || event.conclusion === "timed_out";
}

/**
 * Pick the newest READY production deployment whose SHA is not the failed one.
 * Deployments are assumed newest-first; we still sort defensively.
 */
export function selectLastKnownGood(
  deployments: DeploymentRecord[],
  failedSha: string,
): DeploymentRecord | null {
  const failed = failedSha.toLowerCase();
  const ready = deployments
    .filter((d) => d.production && d.state === "READY" && d.sha && d.id)
    .filter((d) => d.sha.toLowerCase() !== failed && !failed.startsWith(d.sha.toLowerCase()) && !d.sha.toLowerCase().startsWith(failed))
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return ready[0] ?? null;
}

export function classifyRollbackSeverity(event: CiFailureEvent): IncidentTicketInput["severity"] {
  if (event.conclusion === "timed_out") return "SEV-2";
  return "SEV-1";
}

export function buildIncidentTicket(
  event: CiFailureEvent,
  lastKnownGood: DeploymentRecord | null,
  outcome: RollbackOutcome,
): IncidentTicketInput {
  const severity = classifyRollbackSeverity(event);
  const title = `[${severity}] Automated rollback: ${event.workflowName} ${event.conclusion} (${shortSha(event.sha)})`;
  const runCell = event.runUrl ? `[Actions run](${event.runUrl})` : "n/a";
  const lastKnownCell = lastKnownGood
    ? lastKnownGood.url
      ? `[${shortSha(lastKnownGood.sha)}](${lastKnownGood.url}) (\`${lastKnownGood.id}\`)`
      : `\`${lastKnownGood.sha}\` (\`${lastKnownGood.id}\`)`
    : "_none found_";

  const body = [
    "## Automated deploy failure",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| Severity | ${severity} |`,
    `| Workflow | ${event.workflowName} |`,
    `| Conclusion | ${event.conclusion} |`,
    `| Failed SHA | \`${event.sha}\` |`,
    `| Ref | ${event.ref} |`,
    `| Actor | ${event.actor} |`,
    `| Run | ${runCell} |`,
    `| Outcome | ${outcome} |`,
    `| Last known-good | ${lastKnownCell} |`,
    "",
    "This ticket was opened by rollback automation. Do not close it until:",
    "1. Production is serving the last known-good artifact (or a confirmed fix).",
    "2. Health checks (`/api/health`, `/api/status`) pass.",
    "3. A short incident timeline is added below.",
    "",
    "See `docs/operations/auto-rollback.md` and `docs/operations/deployment-runbook.md`.",
  ].join("\n");

  return {
    title,
    body,
    labels: ["incident", severity.toLowerCase(), "deployment"],
    severity,
  };
}

export function buildNotificationPayload(
  event: CiFailureEvent,
  result: Pick<RollbackResult, "outcome" | "reason" | "lastKnownGood" | "rolledBackTo" | "incident">,
  channel: "slack" | "discord",
): NotificationPayload {
  const severity = result.outcome === "skipped" ? "info" : "critical";
  const title =
    result.outcome === "rolled_back"
      ? "Production rolled back after CI failure"
      : result.outcome === "incident_only"
        ? "Deploy failed — rollback could not complete"
        : "Rollback automation skipped";

  return {
    channel,
    title,
    text: result.reason,
    severity,
    url: result.incident?.url ?? event.runUrl,
    fields: {
      workflow: event.workflowName,
      conclusion: event.conclusion,
      failedSha: shortSha(event.sha),
      lastKnownGood: result.lastKnownGood ? shortSha(result.lastKnownGood.sha) : "none",
      rolledBackTo: result.rolledBackTo ?? "n/a",
      incident: result.incident?.url ?? "pending",
      run: event.runUrl,
    },
  };
}

export function slackWebhookBody(payload: NotificationPayload): Record<string, unknown> {
  const color = payload.severity === "critical" ? "#E01E5A" : payload.severity === "warning" ? "#ECB22E" : "#2EB67D";
  return {
    text: payload.title,
    attachments: [
      {
        color,
        title: payload.title,
        title_link: payload.url,
        text: payload.text,
        fields: Object.entries(payload.fields).map(([title, value]) => ({
          title,
          value,
          short: title !== "run" && title !== "incident",
        })),
      },
    ],
  };
}

export function discordWebhookBody(payload: NotificationPayload): Record<string, unknown> {
  const color = payload.severity === "critical" ? 0xe01e5a : payload.severity === "warning" ? 0xecb22e : 0x2eb67d;
  return {
    username: "PromptMint Rollback",
    embeds: [
      {
        title: payload.title,
        description: payload.text,
        url: payload.url,
        color,
        fields: Object.entries(payload.fields).map(([name, value]) => ({
          name,
          value: value.length > 1024 ? `${value.slice(0, 1021)}...` : value,
          inline: name !== "run" && name !== "incident",
        })),
      },
    ],
  };
}

export async function executeRollback(
  event: CiFailureEvent,
  deps: RollbackDependencies,
): Promise<RollbackResult> {
  const notificationsSent: Array<"slack" | "discord"> = [];

  const notifyAll = async (partial: Pick<RollbackResult, "outcome" | "reason" | "lastKnownGood" | "rolledBackTo" | "incident">) => {
    for (const channel of ["slack", "discord"] as const) {
      const sent = await deps.notify(buildNotificationPayload(event, partial, channel));
      if (sent) notificationsSent.push(sent);
    }
  };

  if (!shouldTriggerRollback(event)) {
    const result: RollbackResult = {
      outcome: "skipped",
      reason: `Event is not a production deploy failure (workflow=${event.workflowName}, conclusion=${event.conclusion}, ref=${event.ref}).`,
      failedSha: event.sha,
      notificationsSent,
    };
    return result;
  }

  const deployments = await deps.listProductionDeployments();
  const lastKnownGood = selectLastKnownGood(deployments, event.sha);

  if (!lastKnownGood) {
    const incident = await deps.createIncident(
      buildIncidentTicket(event, null, "incident_only"),
    );
    const result: RollbackResult = {
      outcome: "incident_only",
      reason: "No READY production deployment with a different SHA was found to roll back to.",
      failedSha: event.sha,
      incident,
      notificationsSent,
    };
    await notifyAll(result);
    result.notificationsSent = notificationsSent;
    return result;
  }

  if (deps.dryRun) {
    const incident = await deps.createIncident(
      buildIncidentTicket(event, lastKnownGood, "incident_only"),
    );
    const result: RollbackResult = {
      outcome: "incident_only",
      reason: `Dry-run: would roll back to ${lastKnownGood.id} (${shortSha(lastKnownGood.sha)}).`,
      failedSha: event.sha,
      lastKnownGood,
      incident,
      notificationsSent,
    };
    await notifyAll(result);
    result.notificationsSent = notificationsSent;
    return result;
  }

  const rolled = await deps.rollbackTo(lastKnownGood.id);
  const incident = await deps.createIncident(
    buildIncidentTicket(event, lastKnownGood, "rolled_back"),
  );
  const result: RollbackResult = {
    outcome: "rolled_back",
    reason: `Reverted production to last known-good deployment ${rolled.rolledBackTo} (${shortSha(lastKnownGood.sha)}).`,
    failedSha: event.sha,
    lastKnownGood,
    rolledBackTo: rolled.rolledBackTo,
    incident,
    notificationsSent,
  };
  await notifyAll(result);
  result.notificationsSent = notificationsSent;
  return result;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function parseCiFailureEvent(env: Record<string, string | undefined>): CiFailureEvent {
  return {
    workflowName: env.FAILED_WORKFLOW_NAME || env.GITHUB_WORKFLOW || "Deploy - Frontend to Vercel and Artifacts",
    conclusion: env.FAILED_CONCLUSION || "failure",
    runId: Number(env.FAILED_RUN_ID || env.GITHUB_RUN_ID || "0"),
    runUrl:
      env.FAILED_RUN_URL ||
      `${env.GITHUB_SERVER_URL || "https://github.com"}/${env.GITHUB_REPOSITORY || "unknown"}/actions/runs/${env.FAILED_RUN_ID || env.GITHUB_RUN_ID || "0"}`,
    sha: env.FAILED_SHA || env.GITHUB_SHA || "",
    ref: env.FAILED_REF || env.GITHUB_REF || "refs/heads/main",
    actor: env.FAILED_ACTOR || env.GITHUB_ACTOR || "unknown",
    environment: env.FAILED_ENVIRONMENT || "production",
  };
}

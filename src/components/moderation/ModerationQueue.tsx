import { useState, useEffect, useCallback } from "react";
import {
  Flag,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ShieldOff,
  ShieldCheck,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SkeletonTable } from "../Skeleton";
import {
  fetchModerationQueue,
  moderationAction,
  REPORT_REASONS,
  type AbuseReport,
  type ReportPagination,
  type ReportReason,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/moderation";
import type { SignMessageFn } from "@/lib/auth/moderatorAuth";

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const STATUS_COLORS: Record<ReportStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  under_review: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  resolved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  dismissed: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const TARGET_COLORS: Record<ReportTargetType, string> = {
  prompt: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  review: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  user: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const formatDate = (timestamp: number) => {
  try {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
};

const formatAddress = (address: string) => {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

interface ModerationQueueProps {
  moderatorAddress: string;
  signMessage?: SignMessageFn;
  apiBase?: string;
}

export const ModerationQueue = ({
  moderatorAddress,
  signMessage,
  apiBase = "/api/moderation/queue",
}: ModerationQueueProps) => {
  const [reports, setReports] = useState<AbuseReport[]>([]);
  const [pagination, setPagination] = useState<ReportPagination | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<ReportStatus | "">("");
  const [filterType, setFilterType] = useState<ReportTargetType | "">("");
  const [filterReason, setFilterReason] = useState<ReportReason | "">("");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!signMessage) {
      setError("Wallet does not support message signing — cannot load the queue.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { entries, pagination } = await fetchModerationQueue({
        moderatorAddress,
        signMessage,
        filters: {
          status: filterStatus || undefined,
          targetType: filterType || undefined,
          reason: filterReason || undefined,
          search: search || undefined,
          page,
        },
        apiBase,
      });
      setReports(entries);
      setPagination(pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load moderation queue");
      setReports([]);
    } finally {
      setIsLoading(false);
    }
  }, [moderatorAddress, signMessage, filterStatus, filterType, filterReason, search, page, apiBase]);

  useEffect(() => {
    if (moderatorAddress) load();
  }, [load, moderatorAddress]);

  const applyAction = async (
    report: AbuseReport,
    action: "report_resolved" | "report_dismissed" | "prompt_takedown" | "prompt_reinstated",
  ) => {
    if (!signMessage) return;
    const reason = (notes[report.id] ?? "").trim() || defaultReason(action, report);
    setBusyId(report.id);
    setError(null);
    try {
      if (action === "prompt_takedown" || action === "prompt_reinstated") {
        await moderationAction({
          moderatorAddress,
          signMessage,
          actions: [
            {
              action,
              targetId: report.targetId,
              targetType: "prompt",
              reason,
            },
          ],
        });
      } else {
        await moderationAction({
          moderatorAddress,
          signMessage,
          actions: [
            {
              action,
              targetId: report.id,
              targetType: "report",
              reason,
            },
          ],
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleFilter = () => {
    setPage(1);
    load();
  };

  if (!moderatorAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Flag className="h-12 w-12 text-slate-600 mb-4" />
        <p className="text-slate-400 text-sm">Connect your wallet to review abuse reports</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Flag className="h-6 w-6 text-emerald-400" />
        <h2 className="text-xl font-bold text-white">Abuse Report Queue</h2>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by target, reporter, or details..."
            className="pl-10 h-10 rounded-xl border-white/10 bg-white/5 text-sm"
          />
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ReportStatus | "")}
          className="h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 px-3"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as ReportTargetType | "")}
          className="h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 px-3"
          aria-label="Filter by target type"
        >
          <option value="">All types</option>
          <option value="prompt">Listing</option>
          <option value="review">Review</option>
          <option value="user">User</option>
        </select>

        <select
          value={filterReason}
          onChange={(e) => setFilterReason(e.target.value as ReportReason | "")}
          className="h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 px-3"
          aria-label="Filter by reason"
        >
          <option value="">All reasons</option>
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <Button
          onClick={handleFilter}
          size="sm"
          className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-10"
        >
          <Filter className="h-4 w-4 mr-1" />
          Apply
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {isLoading ? (
        <SkeletonTable rows={5} columns={4} />
      ) : reports.length === 0 ? (
        <div className="text-center py-12">
          <Flag className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">No reports match the current filters</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {reports.map((report) => {
              const open = report.status === "pending" || report.status === "under_review";
              return (
                <div
                  key={report.id}
                  className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                          TARGET_COLORS[report.targetType]
                        }`}
                      >
                        {report.targetType}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                          STATUS_COLORS[report.status]
                        }`}
                      >
                        {STATUS_LABELS[report.status]}
                      </span>
                      <span className="text-xs text-slate-500">{formatDate(report.createdAt)}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      Target: <span className="font-mono text-slate-300">{formatAddress(report.targetId)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-slate-500 text-xs">Reporter</span>
                      <p className="text-slate-300 font-mono text-xs">{formatAddress(report.reporterAddress)}</p>
                    </div>
                    <div>
                      <span className="text-slate-500 text-xs">Reason</span>
                      <p className="text-slate-300 text-xs capitalize">{report.reason.replace("_", " ")}</p>
                    </div>
                  </div>

                  {report.details && (
                    <p className="text-sm text-slate-400 mb-3 rounded-xl bg-white/5 p-3">{report.details}</p>
                  )}

                  <Textarea
                    value={notes[report.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [report.id]: e.target.value }))}
                    rows={2}
                    placeholder="Optional moderation note / reason for this action…"
                    className="border-white/10 bg-white/5 text-slate-200 mb-3 text-sm"
                  />

                  <div className="flex flex-wrap gap-2">
                    {open && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                          disabled={busyId === report.id}
                          onClick={() => applyAction(report, "report_resolved")}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-slate-500/30 text-slate-300 hover:bg-white/5"
                          disabled={busyId === report.id}
                          onClick={() => applyAction(report, "report_dismissed")}
                        >
                          <XCircle className="h-4 w-4" />
                          Dismiss
                        </Button>
                      </>
                    )}

                    {report.targetType === "prompt" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                          disabled={busyId === report.id}
                          onClick={() => applyAction(report, "prompt_takedown")}
                        >
                          <ShieldOff className="h-4 w-4" />
                          Take down listing
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                          disabled={busyId === report.id}
                          onClick={() => applyAction(report, "prompt_reinstated")}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Reinstate listing
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-500">
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} reports
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="border-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-slate-400 min-w-[60px] text-center">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={!pagination.hasMore}
                  className="border-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

function defaultReason(
  action: "report_resolved" | "report_dismissed" | "prompt_takedown" | "prompt_reinstated",
  report: AbuseReport,
): string {
  switch (action) {
    case "report_resolved":
      return `Report upheld: ${report.reason.replace("_", " ")}`;
    case "report_dismissed":
      return "Report reviewed and no action required";
    case "prompt_takedown":
      return `Listing taken down: ${report.reason.replace("_", " ")}`;
    case "prompt_reinstated":
      return "Listing reinstated after review";
  }
}

import { useState, useEffect, useCallback } from "react";
import { Shield, Search, Filter, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { signModeratorAuth, type SignMessageFn } from "../../lib/auth/moderatorAuth";
import { SkeletonTable } from "../Skeleton";

interface ModerationLogEntry {
  id: string;
  action: string;
  moderatorAddress: string;
  targetId: string;
  targetType: "prompt" | "review" | "user";
  reason: string;
  details?: string;
  createdAt: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface LogsResponse {
  entries: ModerationLogEntry[];
  pagination: Pagination;
}

interface AuditLogViewerProps {
  moderatorAddress: string;
  signMessage?: SignMessageFn;
  apiBase?: string;
}

const ACTION_LABELS: Record<string, string> = {
  review_removed: "Review Removed",
  review_approved: "Review Approved",
  user_warned: "User Warned",
  report_resolved: "Report Resolved",
  report_dismissed: "Report Dismissed",
  prompt_takedown: "Listing Taken Down",
  prompt_reinstated: "Listing Reinstated",
  prompt_hidden: "Prompt Hidden",
  prompt_featured: "Prompt Featured",
};

const TARGET_TYPE_COLORS: Record<string, string> = {
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

export const AuditLogViewer = ({
  moderatorAddress,
  signMessage,
  apiBase = "/api/moderation/logs",
}: AuditLogViewerProps) => {
  const [logs, setLogs] = useState<ModerationLogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState("");
  const [filterType, setFilterType] = useState("");
  const [searchTarget, setSearchTarget] = useState("");

  const fetchLogs = useCallback(async () => {
    if (!signMessage) {
      setError("Wallet does not support message signing — cannot verify moderator identity.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { moderatorTimestamp, moderatorSignature } = await signModeratorAuth(
        moderatorAddress,
        "moderation-logs",
        signMessage,
      );

      const params = new URLSearchParams({
        moderatorAddress,
        moderatorTimestamp: String(moderatorTimestamp),
        moderatorSignature,
        page: String(page),
      });
      if (filterAction) params.set("action", filterAction);
      if (filterType) params.set("targetType", filterType);

      const response = await fetch(`${apiBase}?${params}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to fetch logs (${response.status})`);
      }
      const data: LogsResponse = await response.json();
      setLogs(data.entries);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
      setLogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [moderatorAddress, signMessage, page, filterAction, filterType, apiBase]);

  useEffect(() => {
    if (moderatorAddress) {
      fetchLogs();
    }
  }, [fetchLogs, moderatorAddress]);

  const handleFilterChange = () => {
    setPage(1);
    fetchLogs();
  };

  if (!moderatorAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Shield className="h-12 w-12 text-slate-600 mb-4" />
        <p className="text-slate-400 text-sm">Connect your wallet to view moderation logs</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-emerald-400" />
        <h2 className="text-xl font-bold text-white">Moderation Audit Log</h2>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={searchTarget}
            onChange={(e) => setSearchTarget(e.target.value)}
            placeholder="Search by target ID..."
            className="pl-10 h-10 rounded-xl border-white/10 bg-white/5 text-sm"
          />
        </div>

        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 px-3"
          aria-label="Filter by action"
        >
          <option value="">All Actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-10 rounded-xl border border-white/10 bg-white/5 text-sm text-slate-300 px-3"
          aria-label="Filter by target type"
        >
          <option value="">All Types</option>
          <option value="prompt">Prompt</option>
          <option value="review">Review</option>
          <option value="user">User</option>
        </select>

        <Button
          onClick={handleFilterChange}
          size="sm"
          className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold h-10"
        >
          <Filter className="h-4 w-4 mr-1" />
          Apply Filters
        </Button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm font-medium">Error</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <SkeletonTable rows={5} columns={4} />
      ) : logs.length === 0 ? (
        <div className="text-center py-12">
          <Shield className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">No audit log entries found</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center">
                      <Shield className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {ACTION_LABELS[entry.action] || entry.action}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                            TARGET_TYPE_COLORS[entry.targetType] ||
                            "bg-slate-500/10 text-slate-400 border-slate-500/20"
                          }`}
                        >
                          {entry.targetType}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {formatDate(entry.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-slate-500 text-xs">Moderator</span>
                    <p className="text-slate-300 font-mono text-xs">
                      {formatAddress(entry.moderatorAddress)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500 text-xs">Target</span>
                    <p className="text-slate-300 font-mono text-xs">
                      {formatAddress(entry.targetId)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 p-3 rounded-xl bg-white/5">
                  <p className="text-sm text-slate-300">
                    <span className="text-slate-400 font-medium">Reason: </span>
                    {entry.reason}
                  </p>
                  {entry.details && (
                    <p className="text-sm text-slate-400 mt-1">
                      <span className="text-slate-500 font-medium">Details: </span>
                      {entry.details}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-500">
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
                {pagination.total} entries
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

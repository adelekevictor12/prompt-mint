import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  ArrowUpDown,
  ExternalLink,
  ReceiptText,
  Repeat2,
  Trash2,
  Wallet,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  XlmAmountTooltip,
  TimestampTooltip,
} from "@/components/ui/Tooltip";
import { useWallet } from "@/hooks/useWallet";
import { useTransactionHistory } from "@/hooks/useTransactionHistory";
import type {
  TransactionRecord,
  TransactionStatus,
  TransactionType,
} from "@/lib/history/transactions";
import { explorerTxUrl } from "@/lib/stellar/explorer";
import { formatXLM } from "@/lib/formatters";

const TYPE_META: Record<
  TransactionType,
  { label: string; icon: typeof ArrowUpRight }
> = {
  purchase: { label: "Purchase", icon: ArrowDownLeft },
  sale: { label: "Sale", icon: ArrowUpRight },
  transfer: { label: "Transfer", icon: Repeat2 },
};

const STATUS_STYLE: Record<TransactionStatus, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

function toDayStart(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function toDayEnd(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

type SortKey = "type" | "amount" | "status" | "date";
type SortDirection = "asc" | "desc";

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
  { key: "date", label: "Date" },
];

function sortValue(tx: TransactionRecord, key: SortKey): number | string {
  switch (key) {
    case "type":
      return TYPE_META[tx.type].label;
    case "amount":
      return tx.amountStroops ? Number(tx.amountStroops) : -1;
    case "status":
      return tx.status;
    case "date":
    default:
      return tx.timestamp;
  }
}

function sortTransactions(
  records: TransactionRecord[],
  key: SortKey,
  direction: SortDirection
): TransactionRecord[] {
  const sorted = [...records].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });
  return direction === "asc" ? sorted : sorted.reverse();
}

/* eslint-disable no-unused-vars */
interface SortableHeaderProps {
  column: { key: SortKey; label: string };
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (_key: SortKey) => void;
}
/* eslint-enable no-unused-vars */

function SortableHeader({ column, activeKey, direction, onSort }: SortableHeaderProps) {
  const isActive = column.key === activeKey;
  return (
    <th className="py-3 px-4 font-medium">
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className="inline-flex items-center gap-1 uppercase text-xs font-medium text-slate-400 hover:text-white transition-colors"
        aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      >
        {column.label}
        {isActive ? (
          <ArrowUp
            className={`h-3 w-3 transition-transform ${direction === "desc" ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        ) : (
          <ArrowUpDown className="h-3 w-3 text-slate-600" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

function TransactionRow({ tx }: { tx: TransactionRecord }) {
  const meta = TYPE_META[tx.type];
  const Icon = meta.icon;
  return (
    <tr className="border-b border-slate-800 hover:bg-slate-900/40">
      <td className="py-3 px-4">
        <span className="inline-flex items-center gap-2 text-slate-200">
          <Icon className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          {meta.label}
        </span>
      </td>
      <td className="py-3 px-4 text-slate-200">
        {tx.title ? (
          tx.promptId ? (
            <Link
              to={`/prompt/${tx.promptId}`}
              className="hover:text-emerald-400 transition-colors"
            >
              {tx.title}
            </Link>
          ) : (
            tx.title
          )
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-slate-300 font-mono text-sm">
        {tx.amountStroops ? (
          <XlmAmountTooltip stroops={tx.amountStroops} />
        ) : (
          "—"
        )}
      </td>
      <td className="py-3 px-4">
        <Badge className={`border ${STATUS_STYLE[tx.status]}`}>
          {tx.status}
        </Badge>
      </td>
      <td className="py-3 px-4 text-slate-400 text-sm">
        <TimestampTooltip value={tx.timestamp} />
      </td>
      <td className="py-3 px-4">
        {tx.txHash ? (
          <a
            href={explorerTxUrl(tx.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 font-mono transition-colors"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-slate-600 text-xs">n/a</span>
        )}
      </td>
    </tr>
  );
}

function TransactionCard({ tx }: { tx: TransactionRecord }) {
  const meta = TYPE_META[tx.type];
  const Icon = meta.icon;
  return (
    <li className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-slate-200">
          <Icon className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          {meta.label}
        </span>
        <Badge className={`border ${STATUS_STYLE[tx.status]}`}>{tx.status}</Badge>
      </div>

      <div className="mt-3">
        {tx.title ? (
          tx.promptId ? (
            <Link
              to={`/prompt/${tx.promptId}`}
              className="text-sm font-medium text-slate-100 hover:text-emerald-400 transition-colors"
            >
              {tx.title}
            </Link>
          ) : (
            <p className="text-sm font-medium text-slate-100">{tx.title}</p>
          )
        ) : (
          <p className="text-sm text-slate-500">—</p>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Amount</dt>
          <dd className="font-mono text-slate-300">
            {tx.amountStroops ? formatXLM(tx.amountStroops) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Date</dt>
          <dd className="text-slate-300">{new Date(tx.timestamp).toLocaleString()}</dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-slate-800 pt-3">
        {tx.txHash ? (
          <a
            href={explorerTxUrl(tx.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 font-mono transition-colors"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-slate-600 text-xs">Tx hash n/a</span>
        )}
      </div>
    </li>
  );
}

export default function TransactionHistoryPage() {
  const { address } = useWallet();
  const { filtered, filter, setFilter, transactions, clear } =
    useTransactionHistory(address);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sorted = useMemo(
    () => sortTransactions(filtered, sortKey, sortDirection),
    [filtered, sortKey, sortDirection]
  );

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  };

  const typeValue = filter.type ?? "all";
  const statusValue = filter.status ?? "all";

  const applyDateRange = useMemo(
    () => (from: string, to: string) => {
      setFilter({
        ...filter,
        fromTimestamp: toDayStart(from),
        toTimestamp: toDayEnd(to),
      });
    },
    [filter, setFilter]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-10">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ReceiptText className="h-7 w-7 text-emerald-400" aria-hidden="true" />
            <div>
              <h1 className="text-2xl font-semibold">Transaction History</h1>
              <p className="text-sm text-slate-400">
                Your purchases, sales and transfers on the Stellar network.
              </p>
            </div>
          </div>

          {address && transactions.length > 0 && (
            <div className="flex items-center gap-2">
              {confirmingClear ? (
                <>
                  <span className="text-xs text-slate-400">
                    Remove this device&apos;s local history for this wallet?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      clear();
                      setConfirmingClear(false);
                    }}
                    className="rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 transition-colors"
                  >
                    Confirm clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(false)}
                    className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClear(true)}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-red-300 transition-colors"
                  title="This only clears history stored locally on this device; it does not affect your on-chain purchases or marketplace access."
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear my local history
                </button>
              )}
            </div>
          )}
        </header>

        {!address ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-slate-400">
            <Wallet className="h-10 w-10 text-slate-600" aria-hidden="true" />
            <p>Connect your wallet to view your transaction history.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-4 mb-6 p-4 rounded-lg border border-slate-800 bg-slate-900/40">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Type
                <select
                  aria-label="Filter by type"
                  value={typeValue}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      type: e.target.value as TransactionType | "all",
                    })
                  }
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                >
                  <option value="all">All</option>
                  <option value="purchase">Purchase</option>
                  <option value="sale">Sale</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Status
                <select
                  aria-label="Filter by status"
                  value={statusValue}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      status: e.target.value as TransactionStatus | "all",
                    })
                  }
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                >
                  <option value="all">All</option>
                  <option value="success">Success</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-400">
                From
                <input
                  type="date"
                  aria-label="From date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    applyDateRange(e.target.value, toDate);
                  }}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-slate-400">
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    applyDateRange(fromDate, e.target.value);
                  }}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white"
                />
              </label>
            </div>

            {transactions.length === 0 ? (
              <EmptyState
                variant="no-transactions"
                action={
                  <Button
                    asChild
                    className="bg-emerald-500 font-bold text-slate-950 hover:bg-emerald-400"
                  >
                    <Link to="/browse">Browse prompts</Link>
                  </Button>
                }
                size="lg"
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                variant="search-empty"
                title="No matching transactions"
                description="Try clearing or adjusting your filters to see more activity."
                action={
                  <Button
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                    onClick={() =>
                      setFilter({ type: "all", status: "all" })
                    }
                  >
                    Clear filters
                  </Button>
                }
                size="lg"
              />
            ) : (
              <>
                {/* Stacked cards on narrow viewports (below sm: 640px) */}
                <ul className="grid grid-cols-1 gap-3 sm:hidden">
                  {sorted.map((tx) => (
                    <TransactionCard key={tx.id} tx={tx} />
                  ))}
                </ul>

                {/* Sortable, horizontally-scrollable table with a sticky header at sm+ */}
                <div className="hidden sm:block max-h-[70vh] overflow-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 z-10 bg-slate-900/95 text-xs uppercase text-slate-400 backdrop-blur">
                      <tr>
                        {SORT_COLUMNS.map((column) =>
                          column.key === "type" ? (
                            <Fragment key={column.key}>
                              <SortableHeader
                                column={column}
                                activeKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                              <th className="py-3 px-4 font-medium">Prompt</th>
                            </Fragment>
                          ) : (
                            <SortableHeader
                              key={column.key}
                              column={column}
                              activeKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          )
                        )}
                        <th className="py-3 px-4 font-medium">Explorer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((tx) => (
                        <TransactionRow key={tx.id} tx={tx} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

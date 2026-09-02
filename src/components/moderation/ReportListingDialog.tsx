import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Flag, Loader2, Shield } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { REPORT_REASONS, submitReport, type ReportReason, type ReportTargetType } from "@/lib/moderation";
import type { SignMessageFn } from "@/lib/auth/moderatorAuth";

interface ReportListingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reporterAddress: string;
  signMessage?: SignMessageFn;
  targetType: ReportTargetType;
  targetId: string;
  onReported?: () => void;
}

const TARGET_LABELS: Record<ReportTargetType, string> = {
  prompt: "listing",
  review: "review",
  user: "user",
};

export function ReportListingDialog({
  open,
  onOpenChange,
  reporterAddress,
  signMessage,
  targetType,
  targetId,
  onReported,
}: ReportListingDialogProps) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setReason("");
    setDetails("");
    setError(null);
    setSubmitted(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!signMessage) {
      setError("Connect a wallet that supports message signing to file a report.");
      return;
    }
    if (!reason) {
      setError("Please choose a reason for your report.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitReport({
        reporterAddress,
        signMessage,
        targetType,
        targetId,
        reason: reason as ReportReason,
        details: details.trim() || undefined,
      });
      setSubmitted(true);
      onReported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-slate-950/80 backdrop-blur-md" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[120] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl sm:p-8">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-300">
              <Flag className="h-5 w-5" />
            </div>
            <div>
              <Dialog.Title className="text-lg font-bold text-white">
                Report this {TARGET_LABELS[targetType]}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-slate-400">
                Reports are reviewed by moderators. Thank you for keeping the marketplace safe.
              </Dialog.Description>
            </div>
          </div>

          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <Shield className="mt-0.5 h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">Report submitted</p>
                  <p className="mt-1 text-sm text-slate-300">
                    Our moderation team will review it shortly. You won't be notified of the outcome to
                    protect reporter privacy.
                  </p>
                </div>
              </div>
              <Button className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950" onClick={() => handleClose(false)}>
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="report-reason" className="text-sm font-medium text-slate-200">
                  Reason
                </label>
                <select
                  id="report-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as ReportReason)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-200"
                >
                  <option value="">Select a reason…</option>
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="report-details" className="text-sm font-medium text-slate-200">
                  Additional details <span className="text-slate-500">(optional)</span>
                </label>
                <Textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Share any context that will help moderators review this report."
                  className="border-white/10 bg-white/5 text-slate-200"
                />
                <p className="text-right text-xs text-slate-500">{details.length}/2000</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => handleClose(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !reason}
                  className="bg-rose-500 hover:bg-rose-600 text-white"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Flag className="h-4 w-4" />
                      Submit report
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

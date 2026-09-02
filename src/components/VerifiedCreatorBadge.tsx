import { BadgeCheck } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import type { CreatorVerification, VerificationMethod } from "@/lib/identity";

const METHOD_LABEL: Record<VerificationMethod, string> = {
  "sep1-toml": "SEP-1 domain identity",
  "sep12-attestation": "SEP-12 verified identity",
  "external-link": "Externally verified link",
};

interface VerifiedCreatorBadgeProps {
  verification?: CreatorVerification | null;
  variant?: "compact" | "full";
  className?: string;
}

/**
 * Renders a verified-creator badge driven by SEP-1/SEP-12 verification state.
 * Shows nothing for unverified/error states; a muted pending chip for `pending`.
 */
export function VerifiedCreatorBadge({
  verification,
  variant = "full",
  className,
}: VerifiedCreatorBadgeProps) {
  if (!verification || verification.status === "unverified") return null;

  if (verification.status === "pending") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-xs font-medium text-amber-200",
          className,
        )}
        title="Identity verification in progress"
      >
        <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
        Verification pending
      </span>
    );
  }

  if (verification.status === "error") return null;

  const methodLabel = verification.method
    ? METHOD_LABEL[verification.method]
    : "Verified creator";
  const detailLines = [
    verification.name ? `Name: ${verification.name}` : null,
    verification.domain ? `Domain: ${verification.domain}` : null,
    verification.issuedAt
      ? `Issued: ${new Date(verification.issuedAt).toLocaleDateString()}`
      : null,
  ].filter(Boolean) as string[];

  const badgeContent = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-100",
        className,
      )}
    >
      <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
      {variant === "full" ? "Verified creator" : null}
    </span>
  );

  return (
    <Tooltip
      content={
        <span className="block">
          <span className="font-medium">{methodLabel}</span>
          {detailLines.map((line) => (
            <span key={line} className="block text-slate-300">
              {line}
            </span>
          ))}
          {verification.stellarTomlUrl ? (
            <a
              href={verification.stellarTomlUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block text-emerald-300 underline"
            >
              View stellar.toml
            </a>
          ) : null}
        </span>
      }
    >
      <span
        className="inline-flex cursor-default items-center"
        role="status"
        aria-label={`Verified creator via ${methodLabel}`}
      >
        {badgeContent}
      </span>
    </Tooltip>
  );
}

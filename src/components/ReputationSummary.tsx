import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarDays,
  Loader2,
  ShoppingBag,
  Star,
  Trophy,
} from "lucide-react";
import { getPromptsByBuyer, getPromptsByCreator } from "@/lib/stellar/promptHashClient";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { ReviewClient } from "@/lib/reviews/reviewClient";
import {
  computeReputationBadges,
  accountAgeInDays,
  type ReputationBadge,
} from "@/lib/reputation/badges";
import { useCreatorVerification } from "@/hooks/useCreatorVerification";
import { VerifiedCreatorBadge } from "@/components/VerifiedCreatorBadge";

interface ReputationResponse {
  accountCreatedAt: string | null;
  accountAgeDays: number | null;
  completedSales: number;
  verifiedLinks: Array<{ label: string; url: string }>;
  historyStatus: "new" | "established";
  historyLabel: string;
}

const REVIEW_SAMPLE_CAP = 6;

async function fetchReputation(address: string): Promise<ReputationResponse> {
  const response = await fetch(
    `/api/creators/reputation?address=${encodeURIComponent(address)}`,
  );
  if (!response.ok) {
    throw new Error("Reputation is temporarily unavailable.");
  }
  return response.json() as Promise<ReputationResponse>;
}

async function fetchPurchases(address: string): Promise<number> {
  try {
    const prompts = await getPromptsByBuyer(browserStellarConfig, address);
    return prompts.length;
  } catch {
    return 0;
  }
}

async function fetchReviewsReceived(address: string): Promise<number> {
  try {
    const listings = await getPromptsByCreator(browserStellarConfig, address);
    const sample = listings.slice(0, REVIEW_SAMPLE_CAP);
    const results = await Promise.allSettled(
      sample.map((prompt) =>
        ReviewClient.getReviews(prompt.id.toString(), { limit: 50 }),
      ),
    );
    return results.reduce((total, result) => {
      if (result.status === "fulfilled") return total + result.value.reviews.length;
      return total;
    }, 0);
  } catch {
    return 0;
  }
}

function joinDateLabel(accountCreatedAt: string | null): string {
  if (!accountCreatedAt) return "Unknown";
  const parsed = new Date(accountCreatedAt);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function joinDateVerbose(accountCreatedAt: string | null): string {
  if (!accountCreatedAt) return "Join date unavailable";
  const parsed = new Date(accountCreatedAt);
  if (Number.isNaN(parsed.getTime())) return "Join date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

const BADGE_ICONS: Record<ReputationBadge["key"], typeof BadgeCheck> = {
  "verified-creator": BadgeCheck,
  "early-adopter": CalendarDays,
  "top-seller": Trophy,
};

export function ReputationSummary({ address }: { address: string }) {
  const reputationQuery = useQuery({
    queryKey: ["reputation-summary", address],
    queryFn: () => fetchReputation(address),
    staleTime: 60_000,
  });
  const purchasesQuery = useQuery({
    queryKey: ["reputation-purchases", address],
    queryFn: () => fetchPurchases(address),
    staleTime: 60_000,
  });
  const reviewsQuery = useQuery({
    queryKey: ["reputation-reviews", address],
    queryFn: () => fetchReviewsReceived(address),
    staleTime: 60_000,
  });

  const verifiedLinks = reputationQuery.data?.verifiedLinks ?? [];
  const { verification } = useCreatorVerification(address, {
    externalVerified: verifiedLinks.length > 0,
  });

  if (reputationQuery.isLoading) {
    return (
      <section
        role="status"
        aria-label="Loading reputation summary"
        className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"
      >
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading reputation…
      </section>
    );
  }

  if (!reputationQuery.data) {
    return (
      <section
        role="status"
        className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400"
      >
        Reputation summary is temporarily unavailable.
      </section>
    );
  }

  const reputation = reputationQuery.data;
  const badges = computeReputationBadges({
    verifiedLinks: reputation.verifiedLinks,
    accountCreatedAt: reputation.accountCreatedAt,
    completedSales: reputation.completedSales,
  });
  const joinDate = joinDateVerbose(reputation.accountCreatedAt);

  const metrics = [
    {
      label: "Total purchases",
      value: (purchasesQuery.data ?? 0).toLocaleString(),
      hint: "Prompts bought with this wallet",
      icon: ShoppingBag,
    },
    {
      label: "Member since",
      value: joinDateLabel(reputation.accountCreatedAt),
      hint: joinDate,
      icon: CalendarDays,
    },
    {
      label: "Reviews received",
      value: (reviewsQuery.data ?? 0).toLocaleString(),
      hint: "Reviews across this creator's listings",
      icon: Star,
    },
    {
      label: "Completed sales",
      value: reputation.completedSales.toLocaleString(),
      hint: accountAgeInDays(reputation.accountCreatedAt) === null
        ? "Indexed sales on-chain"
        : `Member for ${accountAgeInDays(reputation.accountCreatedAt)} days`,
      icon: ShoppingBag,
    },
  ];

  return (
    <section
      aria-labelledby="reputation-summary-title"
      className="rounded-2xl border border-white/10 bg-[#0d1117] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">
            User reputation
          </p>
          <h2
            id="reputation-summary-title"
            className="mt-2 text-xl font-semibold text-white"
          >
            Activity &amp; badges
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            A snapshot of this wallet's marketplace activity and earned badges.
            All figures are on-chain or review data; badges are derived
            automatically.
          </p>
        </div>
        {badges.length > 0 && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            <VerifiedCreatorBadge verification={verification} />
            {badges.map((badge) => {
              const Icon = BADGE_ICONS[badge.key];
              return (
                <span
                  key={badge.key}
                  title={badge.description}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100"
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {badge.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map(({ label, value, hint, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
          >
            <dt className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-400">
              <Icon aria-hidden="true" className="h-4 w-4 text-emerald-200" />
              {label}
            </dt>
            <dd className="mt-2 text-lg font-semibold text-white">{value}</dd>
            <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
          </div>
        ))}
      </dl>
    </section>
  );
}

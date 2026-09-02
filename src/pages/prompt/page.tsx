import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Flag, PackageSearch } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { PromptModal } from "@/pages/browse/PromptModal";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { SocialShareButtons } from "@/components/SocialShareButtons";
import { ReportListingDialog } from "@/components/moderation/ReportListingDialog";
import { PromptHashClient } from "@/lib/stellar/promptHashClient";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  buildPromptShareUrl,
  parsePromptIdParam,
} from "@/lib/marketplace/shareUrls";
import { fetchPromptStatus } from "@/lib/moderation";
import { useWallet } from "@/hooks/useWallet";
import { SEOHead } from "@/components/seo/SEOHead";
import { Skeleton, SkeletonText } from "@/components/Skeleton";

export default function PromptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const parsed = parsePromptIdParam(id);

  const promptQuery = useQuery({
    queryKey: ["prompt-detail", parsed.ok ? parsed.promptId : null],
    queryFn: async () => {
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      return PromptHashClient.getPrompt(
        browserStellarConfig,
        BigInt(parsed.promptId),
      );
    },
    enabled: parsed.ok,
    retry: false,
  });

  const { address, signMessage } = useWallet();
  const [reportOpen, setReportOpen] = useState(false);

  // Prepare listing metadata for OG tags: only public fields (not gated content)
  const listingMetadata =
    promptQuery.data && promptQuery.data.active
      ? {
          title: promptQuery.data.title,
          description: promptQuery.data.previewText, // public teaser, not gated prompt body
          imageUrl: promptQuery.data.imageUrl,
          creator: promptQuery.data.creator,
          category: promptQuery.data.category,
        }
      : null;

  // Reflect any moderator takedown so buyers don't attempt to purchase removed listings.
  const takedownQuery = useQuery({
    queryKey: ["prompt-takedown", parsed.ok ? parsed.promptId : null],
    queryFn: () => {
      if (!parsed.ok) throw new Error(parsed.error);
      return fetchPromptStatus(parsed.promptId);
    },
    enabled: parsed.ok,
    retry: false,
  });
  const isTakenDown = takedownQuery.data?.takenDown ?? false;

  if (!parsed.ok) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <SEOHead />
        <Navigation />
        <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-300">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold">Invalid prompt link</h1>
          <p className="mt-3 text-sm text-slate-400">{parsed.error}</p>
          <Button asChild className="mt-8 bg-cyan-200 text-slate-950 hover:bg-cyan-100">
            <Link to="/browse">
              <ArrowLeft className="h-4 w-4" />
              Back to marketplace
            </Link>
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  if (promptQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <SEOHead promptId={parsed.promptId} />
        <Navigation />
        <main
          className="mx-auto max-w-3xl space-y-4 px-4 py-8"
          role="status"
          aria-label="Loading listing"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-36" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1419] p-6 space-y-4">
            <Skeleton className="h-52 w-full" />
            <Skeleton className="h-6 w-2/3" />
            <SkeletonText lines={3} />
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (promptQuery.isError || !promptQuery.data) {
    const message =
      promptQuery.error instanceof Error
        ? promptQuery.error.message
        : `Prompt #${parsed.promptId} was not found.`;

    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <SEOHead promptId={parsed.promptId} />
        <Navigation />
        <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-200">
            <PackageSearch className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold">Listing unavailable</h1>
          <p className="mt-3 text-sm text-slate-400">{message}</p>
          <p className="mt-2 max-w-md text-xs text-slate-500">
            The link may be mistyped, or the listing may have been removed from
            discovery. On-chain access rights are unchanged by this page.
          </p>
          <Button asChild className="mt-8 bg-cyan-200 text-slate-950 hover:bg-cyan-100">
            <Link to="/browse">
              <ArrowLeft className="h-4 w-4" />
              Back to marketplace
            </Link>
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  const shareUrl = buildPromptShareUrl(parsed.promptId);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <SEOHead promptId={parsed.promptId} listingMetadata={listingMetadata} />
      <Navigation />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        {isTakenDown && (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-rose-300">This listing has been taken down</p>
              <p className="mt-1 text-sm text-slate-300">
                A moderator removed this listing for {takedownQuery.data?.reason || "policy violations"}.
                Existing on-chain access rights are unchanged.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            asChild
            variant="outline"
            className="border-white/15 bg-white/[0.03] text-white hover:bg-white/10"
          >
            <Link to="/browse">
              <ArrowLeft className="h-4 w-4" />
              Marketplace
            </Link>
          </Button>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-white/15 bg-white/[0.03] text-slate-300 hover:bg-white/10"
                onClick={() => setReportOpen(true)}
              >
                <Flag className="h-4 w-4" />
                Report
              </Button>
              <ShareLinkButton
                url={shareUrl}
                label="Copy listing link"
                shareTitle={promptQuery.data.title}
                shareText={`Check out this prompt on Prompt Mint: ${promptQuery.data.title}`}
              />
            </div>
            <SocialShareButtons
              url={shareUrl}
              shareText={`Check out this prompt on Prompt Mint: ${promptQuery.data.title}`}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Shareable URL:{" "}
          <span className="font-mono text-slate-400">{shareUrl}</span>
        </p>
      </main>

      <ReportListingDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        reporterAddress={address ?? ""}
        signMessage={signMessage}
        targetType="prompt"
        targetId={parsed.promptId}
      />

      <PromptModal
        itemId={parsed.promptId}
        isOpen
        onClose={() => navigate("/browse")}
      />
      <Footer />
    </div>
  );
}

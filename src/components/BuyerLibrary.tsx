import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpenCheck,
  Eye,
  Loader2,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  ShoppingBag,
  WifiOff,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getPromptsByBuyer, type PromptRecord } from "@/lib/stellar/promptHashClient";
import { unlockPromptContent, type IntegrityMetadata } from "@/lib/prompts/unlock";
import { UnlockExplainer, type UnlockState } from "@/components/UnlockExplainer";
import { IntegrityBadge } from "@/components/IntegrityBadge";
import { stellarNetwork } from "@/lib/env";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import { useNetworkState } from "@/hooks/useNetworkState";
import { formatPriceLabel } from "@/lib/stellar/format";
import { Skeleton, SkeletonAvatar, SkeletonText } from "@/components/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { BuyerLibraryRowSkeleton } from "@/components/MarketplaceSkeletons";
import { TransferLicense, type TransferLicenseData } from "@/components/TransferLicense";

const EXPECTED_NETWORK = stellarNetwork;

interface CachedBuyerLibrary {
  timestamp: number;
  prompts: PromptRecord[];
}

function getCachedBuyerPrompts(address?: string): CachedBuyerLibrary | null {
  if (!address) return null;
  try {
    const raw = window.localStorage.getItem(`prompt-mint:buyer-library-cache:${address}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore malformed cache entries
  }
  return null;
}

function setCachedBuyerPrompts(address: string, prompts: PromptRecord[]) {
  try {
    window.localStorage.setItem(
      `prompt-mint:buyer-library-cache:${address}`,
      JSON.stringify({ timestamp: Date.now(), prompts }),
    );
  } catch {
    // ignore write failures (e.g., quota exceeded)
  }
}


function PromptLibraryCard({
  prompt,
  plaintext,
  integrity,
  unlockState,
  isBusy,
  onUnlock,
  onTransfer,
}: {
  prompt: PromptRecord;
  plaintext?: string;
  integrity?: IntegrityMetadata;
  unlockState: UnlockState;
  isBusy: boolean;
  onUnlock: () => void;
  onTransfer: () => void;
}) {
  const isUnlocked = Boolean(plaintext);
  const showExplainer = unlockState !== "idle" && unlockState !== "success";

  return (
    <article className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1419] transition-colors hover:border-white/[0.18]">
      <div className="p-5 space-y-4">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
                <BookOpenCheck className="mr-1 h-3 w-3" />
                License owned
              </Badge>
              <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
                {prompt.category}
              </Badge>
              <Badge
                className={
                  isUnlocked
                    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
                    : "border-amber-300/30 bg-amber-300/10 text-amber-100"
                }
              >
                {isUnlocked ? (
                  <Eye className="mr-1 h-3 w-3" />
                ) : (
                  <LockKeyhole className="mr-1 h-3 w-3" />
                )}
                {isUnlocked ? "Unlocked" : "Locked"}
              </Badge>
            </div>
            <h3 className="text-base font-semibold text-white leading-snug">
              {prompt.title}
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 line-clamp-2">
              {prompt.previewText}
            </p>
          </div>
          <div className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
              Paid
            </p>
            <p className="mt-0.5 text-sm font-semibold text-white">
              {formatPriceLabel(prompt.priceStroops)} XLM
            </p>
          </div>
        </div>

        {/* Unlock explainer — shown for non-idle, non-success states */}
        {showExplainer && (
          <UnlockExplainer
            state={unlockState}
            onRetry={
              unlockState === "rejected" ||
                unlockState === "expired" ||
                unlockState === "failed"
                ? onUnlock
                : undefined
            }
          />
        )}

        {/* Unlocked content — only rendered when plaintext is present */}
        {isUnlocked && plaintext && (
          <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/[0.07] p-4 space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200">
              Decrypted content
            </div>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-200">
              {plaintext}
            </pre>
            {/* Cryptographic provenance badge */}
            {integrity && <IntegrityBadge integrity={integrity} />}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            className="flex-1 h-9 bg-cyan-200 text-slate-950 hover:bg-cyan-100 disabled:opacity-50 text-xs font-bold"
            onClick={onUnlock}
            disabled={
              isBusy ||
              unlockState === "signing" ||
              unlockState === "verifying" ||
              unlockState === "integrity_failed"
            }
          >
            {isBusy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Unlocking…
              </>
            ) : isUnlocked ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                Re-open prompt
              </>
            ) : (
              <>
                <LockKeyhole className="h-3.5 w-3.5" />
                Unlock full prompt
              </>
            )}
          </Button>
          <Button
            className="flex-shrink-0 h-9 px-4 bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50 text-xs font-bold"
            onClick={onTransfer}
            disabled={isBusy || unlockState === "signing" || unlockState === "verifying"}
            title="Transfer this license to another address"
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function BuyerLibrary() {
  const { address, network, signMessage } = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<Record<string, string>>({});
  const [integrityMap, setIntegrityMap] = useState<Record<string, IntegrityMetadata>>({});
  const [unlockStates, setUnlockStates] = useState<Record<string, UnlockState>>({});
  const [transferingPromptId, setTransferingPromptId] = useState<string | null>(null);

  const isWrongNetwork =
    Boolean(address) &&
    Boolean(network) &&
    network?.toLowerCase() !== EXPECTED_NETWORK.toLowerCase();

  const networkState = useNetworkState();

  const query = useQuery({
    queryKey: ["buyer-library", address],
    queryFn: async () => {
      if (!address) return [];
      try {
        const livePrompts = await getPromptsByBuyer(browserStellarConfig, address);
        if (livePrompts && livePrompts.length > 0) {
          setCachedBuyerPrompts(address, livePrompts);
        }
        return livePrompts;
      } catch (err) {
        const cached = getCachedBuyerPrompts(address);
        if (cached && cached.prompts.length > 0) {
          return cached.prompts;
        }
        throw err;
      }
    },
    enabled: Boolean(address) && !isWrongNetwork,
  });

  const cachedData = getCachedBuyerPrompts(address);
  const prompts = query.data ?? cachedData?.prompts ?? [];
  const isUsingCache =
    query.isError ||
    !networkState.isOnline ||
    (query.isSuccess && !query.isFetchedAfterMount);
  const freshnessTimestamp = query.dataUpdatedAt || cachedData?.timestamp || null;

  const setUnlockState = (id: string, state: UnlockState) =>
    setUnlockStates((prev) => ({ ...prev, [id]: state }));

  const handleUnlock = async (prompt: PromptRecord) => {
    if (!address || !signMessage) return;
    const id = prompt.id.toString();
    setBusyId(id);
    setUnlockState(id, "signing");
    try {
      const result = await unlockPromptContent(address, id, signMessage);
      setUnlockState(id, "success");
      setUnlocked((prev) => ({ ...prev, [id]: result.plaintext }));
      setIntegrityMap((prev) => ({ ...prev, [id]: result.integrity }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.toLowerCase().includes("declined") || msg.toLowerCase().includes("rejected")) {
        setUnlockState(id, "rejected");
      } else if (msg.toLowerCase().includes("expired")) {
        setUnlockState(id, "expired");
      } else if (
        msg.toLowerCase().includes("integrity") ||
        msg.toLowerCase().includes("verified")
      ) {
        setUnlockState(id, "integrity_failed");
      } else {
        setUnlockState(id, "failed");
      }
    } finally {
      setBusyId(null);
    }
  };

  const transferingPrompt = transferingPromptId
    ? prompts.find((p) => p.id.toString() === transferingPromptId)
    : null;

  if (!address)
    return (
      <EmptyState
        variant="custom"
        icon={PlugZap}
        title="Wallet not connected"
        description="Connect your Stellar wallet to view prompts you have purchased."
      />
    );
  if (isWrongNetwork)
    return (
      <EmptyState
        variant="custom"
        icon={WifiOff}
        title="Wrong network"
        description={`You are connected to ${network ?? "an unknown network"}. Switch to ${EXPECTED_NETWORK} to view your library.`}
      />
    );

  if (query.isLoading && prompts.length === 0) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading your library">
        {[...Array(3)].map((_, i) => (
          <BuyerLibraryRowSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (query.isError && prompts.length === 0) {
    return (
      <EmptyState
        variant="error"
        title="Failed to load library"
        description="Could not read purchased prompts from the contract."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
            className="border border-white/10 text-slate-300 hover:bg-white/10 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        }
      />
    );
  }

  if (prompts.length === 0)
    return (
      <EmptyState
        variant="no-purchases"
        action={
          <Button asChild className="h-9 bg-cyan-200 text-slate-950 hover:bg-cyan-100 px-5">
            <Link to="/browse">
              <ShoppingBag className="h-4 w-4" />
              Browse marketplace
            </Link>
          </Button>
        }
      />
    );

  return (
    <Fragment>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <FreshnessBadge
            timestamp={freshnessTimestamp}
            isCached={isUsingCache}
            isOffline={!networkState.isOnline}
            isDegraded={networkState.isDegraded}
          />
          {!networkState.canTrustConfirmation && (
            <div className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg">
              Unlock Service Unavailable — Reconnect to verify on-chain license
            </div>
          )}
        </div>

        {prompts.map((prompt) => {
          const id = prompt.id.toString();
          return (
            <PromptLibraryCard
              key={id}
              prompt={prompt}
              plaintext={unlocked[id]}
              integrity={integrityMap[id]}
              unlockState={unlockStates[id] ?? "idle"}
              isBusy={busyId === id}
              onUnlock={() => void handleUnlock(prompt)}
              onTransfer={() => setTransferingPromptId(id)}
            />
          );
        })}
      </div>

      {/* Transfer License Modal */}
      {transferingPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0a0e13] rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <TransferLicense
              prompt={{
                id: transferingPrompt.id.toString(),
                title: transferingPrompt.title,
                priceStroops: transferingPrompt.priceStroops,
                imageUrl: transferingPrompt.imageUrl,
                category: transferingPrompt.category,
                creator: transferingPrompt.creator,
                previewText: transferingPrompt.previewText,
              }}
              onClose={() => setTransferingPromptId(null)}
              onSuccess={() => {
                setTransferingPromptId(null);
                void query.refetch();
              }}
            />
          </div>
        </div>
      )}
    </Fragment>
  );
}
                      Unlock Service Unavailable — Reconnect to verify on - chain license
                    </div >
                  )}
                </div >

{
  prompts.map((prompt) => {
    const id = prompt.id.toString();
    return (
      <PromptLibraryCard
        key={id}
        prompt={prompt}
        plaintext={unlocked[id]}
        integrity={integrityMap[id]}
        unlockState={unlockStates[id] ?? "idle"}
        isBusy={busyId === id}
        onUnlock={() => void handleUnlock(prompt)}
      />
    );
  })
}
              </div >
              );
}

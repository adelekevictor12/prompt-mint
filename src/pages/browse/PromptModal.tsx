import React, { useState, useContext, useEffect, useRef } from "react";
import { WalletContext } from "../../providers/WalletProvider";
import { useAsyncTransaction } from "../../components/useAsyncTransaction";
import { estimateSingleFee, type FeeEstimate } from "@/lib/checkout/feeEstimation";
import { FeeEstimateBanner } from "@/components/FeeEstimateBanner";
import { PromptHashClient } from "../../lib/stellar/promptHashClient";
import { unlockPrompt } from "../../lib/prompts/unlock";
import { Skeleton } from "../../components/Skeleton";
import { PromptModalSkeleton } from "@/components/MarketplaceSkeletons";
import { StatusBanner } from "../../components/StatusBanner";
import { UnlockExplainer } from "../../components/UnlockExplainer";
import { copyToClipboard } from "../../lib/clipboard/secureClipboard";
import { WatermarkedPreview } from "../../components/WatermarkedPreview";
import { CopyButton } from "../../components/CopyButton";
import {
  CheckCircle,
  Loader2,
  LockKeyhole,
  X,
  ExternalLink,
  ShieldCheck,
  Wallet,
  MessageSquare,
  Copy,
  Check,
  User,
  DollarSign,
  ShoppingBag,
  Hash,
  AlertTriangle,
  Info,
  Gift,
  Link2,
  ShoppingCart,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ReviewForm } from "../../components/prompts/ReviewForm";
import { ReviewList } from "../../components/prompts/ReviewList";
import { StarRating } from "../../components/prompts/StarRating";
import { ReviewClient, type ReviewSort } from "../../lib/reviews/reviewClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browserStellarConfig } from "../../lib/stellar/browserConfig";
import { NetworkMismatchBanner } from "../../components/wallet/NetworkMismatchBanner";
import { detectNetworkMismatch } from "../../lib/wallet/networkDetection";
import { CurrencyPrice } from "../../components/CurrencyPrice";
import { AddressTooltip, ContractStateTooltip } from "@/components/ui/Tooltip";
import { useNetworkState } from "@/hooks/useNetworkState";
import { useAddToCart } from "@/hooks/useAddToCart";
import { GiftPrompt } from "../../components/GiftPrompt";
import { trackEventWithWallet } from "../../lib/analytics/track";
import { useTrackPromptView } from "@/hooks/useRecentlyViewed";
import { SEOHead } from "../../components/seo/SEOHead";
import {
  buildCreatorSharePath,
  buildPromptShareUrl,
} from "@/lib/marketplace/shareUrls";
import { translateError } from "../../lib/i18n-errors";
import { createFocusTrapKeydownHandler } from "@/lib/a11y/focusTrap";
import { explorerTxUrl } from "../../lib/stellar/explorer";
import { recordTransaction } from "../../lib/history/transactions";

export type BuyerStatus =
  | "IDLE"
  | "AWAITING_APPROVAL"
  | "CONFIRMING"
  | "PURCHASED_LOCKED"
  | "UNLOCKING"
  | "SUCCESS"
  | "ERROR";

interface PromptModalProps {
  itemId: string;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

// Metadata display component
const PromptMetadataSection: React.FC<{ itemId: string; status: BuyerStatus }> = ({ itemId, status }) => {
  const { data: prompt, isLoading } = useQuery({
    queryKey: ["prompt-detail", itemId],
    queryFn: async () => {
      return await PromptHashClient.getPrompt(browserStellarConfig, BigInt(itemId));
    },
    enabled: !!itemId,
  });

  if (isLoading) {
    return <PromptModalSkeleton />;
  }

  if (!prompt) return null;

  const isPurchased = status === "PURCHASED_LOCKED" || status === "SUCCESS";
  let creatorHref: string | null = null;
  try {
    creatorHref = buildCreatorSharePath(prompt.creator);
  } catch {
    // Invalid creator addresses stay as plain text.
  }

  return (
    <div className="mb-6 space-y-4">
      {/* Preview Content – rendered as markdown, watermarked for non-owners */}
      <WatermarkedPreview
        content={prompt.previewText}
        hasAccess={isPurchased}
        previewLength={200}
      />

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <User className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Creator</p>
          </div>
          <div className="flex items-center gap-1.5">
            {creatorHref ? (
              <Link
                to={creatorHref}
                className="text-xs font-mono text-cyan-200 truncate hover:text-cyan-100 underline-offset-2 hover:underline"
              >
                <AddressTooltip address={prompt.creator} />
              </Link>
            ) : (
              <p className="text-xs font-mono text-white truncate">
                <AddressTooltip address={prompt.creator} />
              </p>
            )}
            <CopyButton
              value={prompt.creator}
              label="creator address"
              variant="inline"
            />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Price</p>
          </div>
          <p className="text-sm font-bold text-white"><CurrencyPrice stroops={prompt.priceStroops} /></p>
        </div>

        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Sales</p>
          </div>
          <p className="text-sm font-bold text-white">{prompt.salesCount}</p>
        </div>

        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <Hash className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Content Hash</p>
          </div>
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-mono text-white truncate" title={prompt.contentHash}>
              {prompt.contentHash.slice(0, 8)}...
            </p>
            <CopyButton
              value={prompt.contentHash}
              label="content hash"
              variant="inline"
            />
          </div>
        </div>

        {/* #131 – Classification */}
        {prompt.classification && (
          <div className="p-3 rounded-lg bg-white/5 border border-white/5">
            <div className="flex items-center gap-2 mb-1">
              {prompt.classification === "sensitive" || prompt.classification === "restricted" ? (
                <AlertTriangle className="h-3 w-3 text-slate-400" />
              ) : (
                <Info className="h-3 w-3 text-slate-400" />
              )}
              <p className="text-xs text-slate-400">Classification</p>
            </div>
            <p className={`text-sm font-bold ${
              prompt.classification === "restricted"
                ? "text-rose-400"
                : prompt.classification === "sensitive"
                  ? "text-amber-400"
                  : "text-white"
            }`}>
              {prompt.classification.charAt(0).toUpperCase() + prompt.classification.slice(1)}
            </p>
          </div>
        )}
      </div>

      {/* #131 – Safety Disclosures */}
      {prompt.safetyFlags && prompt.safetyFlags.length > 0 && !prompt.safetyFlags.includes("none") && (
        <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-4 w-4 text-cyan-400" />
            <p className="text-xs uppercase tracking-wider text-cyan-400 font-semibold">Safety Disclosures</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {prompt.safetyFlags.map((flag) => (
              <span
                key={flag}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
              >
                {flag.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            These disclosures are attested by the creator. Content may be subject to moderation review.
          </p>
        </div>
      )}

      {/* Purchase State Indicator */}
      {isPurchased && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          <p className="text-xs text-emerald-300 font-semibold">You own this prompt license</p>
        </div>
      )}

      {!prompt.active && (
        <div className="p-3 rounded-lg bg-slate-500/10 border border-slate-500/20 flex items-center gap-2">
          <X className="h-4 w-4 text-slate-400" />
          <p className="text-xs text-slate-400 font-semibold">
            This prompt is{" "}
            <ContractStateTooltip
              state="expired"
              detail="The creator has taken this listing offline."
            />
          </p>
        </div>
      )}
    </div>
  );
};

export const PromptModal: React.FC<PromptModalProps> = ({
  itemId,
  isOpen,
  onClose,
  onRefresh,
}) => {
  const wallet = useContext(WalletContext);
  const queryClient = useQueryClient();
  const { addToCart, isInCart } = useAddToCart();

  const [status, setStatus] = useState<BuyerStatus>("IDLE");
  const [txHash, setTxHash] = useState<string>("");
  const [secretContent, setSecretContent] = useState<string>("");
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewSort, setReviewSort] = useState<ReviewSort>("newest");
  const [reviewRating, setReviewRating] = useState<number | undefined>();
  const [copyFeedback, setCopyFeedback] = useState<{
    visible: boolean;
    success: boolean;
    message: string;
  }>({ visible: false, success: false, message: "" });
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [showGiftModal, setShowGiftModal] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  // Fetch prompt data for gift modal and OG metadata generation
  const { data: promptData } = useQuery({
    queryKey: ["prompt-detail", itemId],
    queryFn: async () => {
      return await PromptHashClient.getPrompt(browserStellarConfig, BigInt(itemId));
    },
    enabled: isOpen,
  });
  // Track this prompt view in recently viewed (privacy-controlled)
  useTrackPromptView(wallet?.address ?? null, itemId, isOpen);

  // Fetch reviews for this prompt
  const { data: reviewData, isLoading: reviewsLoading } = useQuery({
    queryKey: ["reviews", itemId, reviewPage, reviewSort, reviewRating],
    queryFn: () => ReviewClient.getReviews(itemId, { page: reviewPage, limit: 10, sort: reviewSort, rating: reviewRating }),
    enabled: isOpen,
  });

  // Fetch review eligibility for connected user
  const { data: eligibilityData } = useQuery({
    queryKey: ["review-eligibility", itemId, wallet?.address],
    queryFn: () => ReviewClient.checkEligibility(itemId, wallet!.address!),
    enabled: isOpen && Boolean(wallet?.address),
  });


  useEffect(() => {
    if (isOpen) {
      lastActiveElementRef.current = document.activeElement as HTMLElement;
      setTimeout(() => closeButtonRef.current?.focus(), 0);

      // #270 – shared, unit-tested focus-trap + Escape handler.
      const handleKeyDown = createFocusTrapKeydownHandler({
        container: () => modalRef.current,
        onEscape: onClose,
      });

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        if (lastActiveElementRef.current) {
          lastActiveElementRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && wallet?.address) {
      setIsCheckingAccess(true);
      PromptHashClient.checkAccess(itemId, wallet.address)
        .then((hasAccess) => setStatus(hasAccess ? "PURCHASED_LOCKED" : "IDLE"))
        .catch(() => setStatus("IDLE"))
        .finally(() => setIsCheckingAccess(false));
    }
  }, [isOpen, itemId, wallet?.address]);

  useEffect(() => {
    if (isOpen && status === "IDLE") {
      setIsEstimatingFee(true);
      estimateSingleFee()
        .then(setFeeEstimate)
        .finally(() => setIsEstimatingFee(false));
    }
  }, [isOpen, status]);

  // Only fire once per modal open per prompt — wallet.address changing mid-session
  // (e.g. account switch) shouldn't re-fire a view event, so it's read via a ref
  // rather than listed as an effect dependency.
  const walletAddressRef = useRef<string | undefined>(wallet?.address);
  walletAddressRef.current = wallet?.address;

  useEffect(() => {
    if (isOpen && itemId) {
      trackEventWithWallet("prompt_viewed", walletAddressRef.current, { promptId: itemId });
    }
  }, [isOpen, itemId]);

  const {
    execute: runUnlock,
    isLoading: isUnlocking,
    error: unlockError,
  } = useAsyncTransaction(
    async (hash: string) => {
      if (!wallet?.signMessage || !wallet.address) throw new Error("Wallet not connected");
      return await unlockPrompt(itemId, hash, wallet.signMessage, wallet.address);
    },
    {
      onOptimistic: () => setStatus("UNLOCKING"),
      onSuccess: (data) => {
        setSecretContent(data.decryptedContent);
        setStatus("SUCCESS");
        trackEventWithWallet("prompt_unlocked", wallet?.address, { promptId: itemId });
      },
      onError: () => {
        setStatus("PURCHASED_LOCKED");
        trackEventWithWallet("prompt_unlock_failed", wallet?.address, {
          promptId: itemId,
          reasonCode: "unlock_error",
        });
      },
    },
  );

  const networkState = useNetworkState();

  const {
    execute: runPurchase,
    isLoading: isPurchasing,
    error: purchaseError,
  } = useAsyncTransaction(
    async () => {
      if (!wallet?.address) throw new Error("Wallet connection required.");
      if (!networkState.canTrustConfirmation) {
        throw new Error("Network connection lost or degraded. Transaction confirmation cannot be trusted.");
      }
      
      // Check network state before purchase
      const walletNetworkState = detectNetworkMismatch(
        !!wallet.address,
        wallet.network,
        wallet.status
      );
      
      if (walletNetworkState.type === "wrong-network") {
        throw new Error(walletNetworkState.message || "Wrong network connected");
      }
      
      if (walletNetworkState.type === "disconnected") {
        throw new Error("Please connect your wallet first");
      }
      
      setStatus("AWAITING_APPROVAL");
      trackEventWithWallet("prompt_purchase_initiated", wallet.address, { promptId: itemId });
      const mockHash = "tx_" + Math.random().toString(16).slice(2, 14);
      setTxHash(mockHash);
      setStatus("CONFIRMING");
      return await PromptHashClient.purchasePrompt(itemId, wallet.address);
    },
    {
      onSuccess: (data) => {
        setStatus("UNLOCKING");
        onRefresh?.();
        trackEventWithWallet("prompt_purchase_completed", wallet?.address, { promptId: itemId });
        if (wallet?.address) {
          const hash = data.txHash || txHash;
          recordTransaction(wallet.address, {
            id: hash || `purchase-${itemId}-${Date.now()}`,
            txHash: hash || undefined,
            type: "purchase",
            status: "success",
            timestamp: Date.now(),
            promptId: itemId,
            title: promptData?.title,
            amountStroops: promptData?.priceStroops
              ? String(promptData.priceStroops)
              : undefined,
          });
        }
        runUnlock(data.txHash || txHash).catch(() => {});
      },
      onError: () => {
        setStatus("ERROR");
        trackEventWithWallet("prompt_purchase_failed", wallet?.address, {
          promptId: itemId,
          reasonCode: "purchase_error",
        });
      },
    },
  );

  const handleCopyContent = async () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    const result = await copyToClipboard(secretContent);

    setCopyFeedback({
      visible: true,
      success: result.success,
      message: result.success
        ? "Copied to clipboard"
        : result.error || "Failed to copy",
    });

    copyTimeoutRef.current = setTimeout(() => {
      setCopyFeedback((prev) => ({ ...prev, visible: false }));
    }, 3000);
  };

  const handleCopyShareLink = async () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    let shareUrl: string;
    try {
      shareUrl = buildPromptShareUrl(itemId);
    } catch (error) {
      setCopyFeedback({
        visible: true,
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to build a shareable link for this listing.",
      });
      copyTimeoutRef.current = setTimeout(() => {
        setCopyFeedback((prev) => ({ ...prev, visible: false }));
      }, 3000);
      return;
    }

    const result = await copyToClipboard(shareUrl);
    setCopyFeedback({
      visible: true,
      success: result.success,
      message: result.success
        ? "Link copied"
        : result.error || "Failed to copy link",
    });

    copyTimeoutRef.current = setTimeout(() => {
      setCopyFeedback((prev) => ({ ...prev, visible: false }));
    }, 3000);
  };

  if (!isOpen) return null;

  // Prepare listing metadata for OG tags: only public fields (not gated content)
  const listingMetadata =
    promptData && promptData.active
      ? {
          title: promptData.title,
          description: promptData.previewText, // public teaser, not gated prompt body
          imageUrl: promptData.imageUrl,
          creator: promptData.creator,
          category: promptData.category,
        }
      : null;

  return (
    <>
      <SEOHead promptId={itemId} listingMetadata={listingMetadata} />
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-4">
      <div
        ref={modalRef}
        className="relative max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-white/10 bg-slate-900 shadow-2xl sm:rounded-[32px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        aria-describedby="prompt-modal-description"
      >
        {/* Header Decor */}
        <div className="h-2 w-full bg-gradient-to-r from-emerald-500 to-blue-500" />

        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full bg-white/5 text-slate-400 hover:text-white transition-all z-10"
          aria-label="Close prompt modal"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-5 sm:p-8">
          <div className="mb-6 sm:mb-8">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3 pr-10">
              <div>
                <h2 id="prompt-modal-title" className="mb-2 text-2xl font-bold text-white">
                  Acquire License
                </h2>
                <p id="prompt-modal-description" className="text-sm text-slate-400">
                  Unlock high-quality prompt content via Stellar smart contract.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-3 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                aria-label="Copy shareable listing link"
              >
                {copyFeedback.visible &&
                copyFeedback.success &&
                copyFeedback.message === "Link copied" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-300" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Copy link
              </button>
            </div>
          </div>

          {/* Prompt Metadata Section */}
          <PromptMetadataSection itemId={itemId} status={status} />

          {isCheckingAccess ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="h-14 w-full bg-white/5 rounded-2xl animate-pulse mt-8" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Network Mismatch Warning */}
              <NetworkMismatchBanner />

              {/* TRANSACTION STAGES */}
              {(status === "IDLE" || status === "ERROR") && (
                <div className="space-y-6">
                  <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex gap-4 items-start">
                    <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-white">
                        Secure Purchase
                      </h4>
                      <p className="text-xs text-slate-400 leading-relaxed mt-1">
                        Funds are held by the contract until access rights are
                        minted. Platform fee is included in the price.
                      </p>
                    </div>
                  </div>

                  {!networkState.canTrustConfirmation && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                      Transactions disabled: Network connection lost or RPC unavailable. Reconnect to purchase.
                    </div>
                  )}

                  {status === "ERROR" && purchaseError && (
                    <StatusBanner
                      status="error"
                      message={translateError(purchaseError.message)}
                    />
                  )}

                  {status === "IDLE" && (
                    <FeeEstimateBanner fee={feeEstimate} isLoading={isEstimatingFee} />
                  )}

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => runPurchase().catch(() => {})}
                      disabled={
                        isPurchasing ||
                        !networkState.canTrustConfirmation ||
                        detectNetworkMismatch(!!wallet?.address, wallet?.network, wallet?.status).type !== "correct"
                      }
                      className="flex-1 group h-14 bg-white text-slate-950 hover:bg-emerald-400 font-black rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isPurchasing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : !networkState.canTrustConfirmation ? (
                        "Transactions Unavailable"
                      ) : (
                        <>
                          Confirm & Purchase <Wallet className="w-4 h-4" />
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => addToCart(itemId)}
                      disabled={isInCart(itemId)}
                      className="h-14 px-6 border-2 border-white/20 bg-white/5 hover:bg-white/10 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                    >
                      {isInCart(itemId) ? (
                        <>
                          <Check className="w-4 h-4" />
                          In Cart
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="w-4 h-4" />
                          Add to Cart
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowGiftModal(true)}
                      disabled={
                        !wallet?.address ||
                        !networkState.canTrustConfirmation
                      }
                      className="h-14 px-6 border-2 border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 font-bold rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-purple-300"
                    >
                      <Gift className="w-4 h-4" />
                      Gift
                    </button>
                  </div>
                </div>
              )}

              {status === "AWAITING_APPROVAL" && (
                <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center" role="status" aria-live="polite">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" aria-hidden="true" />
                    <div className="absolute inset-0 blur-xl bg-emerald-500/20" />
                  </div>
                  <p className="text-slate-200 font-bold text-lg italic tracking-tight">
                    Confirming in Wallet...
                  </p>
                </div>
              )}

              {status === "CONFIRMING" && (
                <div className="py-6 text-center" role="status" aria-live="polite">
                  <StatusBanner
                    status="pending"
                    message="Broadcasting to Stellar..."
                  />
                  {txHash && (
                    <div className="mt-6 flex items-center gap-2">
                      <a
                        href={explorerTxUrl(txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-emerald-400 font-mono transition-colors"
                      >
                        View Transaction <ExternalLink className="h-3 w-3" />
                      </a>
                      <CopyButton
                        value={txHash}
                        label="transaction hash"
                        variant="icon"
                      />
                    </div>
                  )}
                </div>
              )}

              {status === "PURCHASED_LOCKED" && (
                <div className="space-y-6">
                  <div className="p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center text-center">
                    <LockKeyhole className="w-8 h-8 text-emerald-400 mb-3" />
                    <h4 className="font-bold text-white">License Verified</h4>
                    <p className="text-xs text-slate-400 mt-2">
                      Ownership detected on-chain. Sign the unlock request to
                      decrypt.
                    </p>
                  </div>

                  {/* Explain what the signature does — always visible before and during signing */}
                  <UnlockExplainer
                    state="signing"
                    onRetry={
                      unlockError
                        ? () => runUnlock(txHash || "existing")
                        : undefined
                    }
                  />

                  {unlockError && (
                    <StatusBanner
                      status="error"
                      message={translateError(unlockError.message)}
                    />
                  )}

                  <button
                    onClick={() => runUnlock(txHash || "existing").catch(() => {})}
                    disabled={isUnlocking}
                    className="w-full h-14 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-2xl transition-all shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)]"
                  >
                    {isUnlocking ? "Unlocking..." : "Decrypt Content"}
                  </button>
                </div>
              )}

              {status === "SUCCESS" && (
                <div className="animate-in fade-in zoom-in duration-300">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold mb-4">
                    <CheckCircle className="h-5 w-5" /> Access Granted
                  </div>
                  <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl blur opacity-20 group-hover:opacity-30 transition" />
                    <div className="relative bg-black border border-white/5 rounded-xl p-6 max-h-[300px] overflow-y-auto">
                      <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {secretContent}
                      </pre>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={handleCopyContent}
                      className="flex-1 flex items-center justify-center gap-2 h-12 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-semibold rounded-xl transition-all border border-emerald-500/30"
                      title="Copy prompt content to clipboard"
                    >
                      {copyFeedback.visible && copyFeedback.success ? (
                        <>
                          <Check className="h-4 w-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>

                  {copyFeedback.visible && !copyFeedback.success && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                      {copyFeedback.message}
                    </div>
                  )}

                  <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <p className="text-xs text-blue-300 leading-relaxed">
                      Please store your purchased prompt content securely. Do not share this content publicly or with unauthorized users.
                    </p>
                  </div>

                  {/* Review Section */}
                  {wallet?.address && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                      {eligibilityData?.alreadyReviewed ? (
                        <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300 flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-cyan-400" />
                          You have already reviewed this prompt. Thank you for your feedback!
                        </div>
                      ) : eligibilityData?.eligible || status === "SUCCESS" || status === "PURCHASED_LOCKED" ? (
                        !showReviewForm ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                              <ShieldCheck className="h-3.5 w-3.5" /> Verified Purchaser Access
                            </div>
                            <button
                              onClick={() => setShowReviewForm(true)}
                              className="w-full flex items-center justify-center gap-2 h-12 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-semibold rounded-xl transition-all"
                            >
                              <MessageSquare className="h-4 w-4" />
                              Write a Review
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-white">Share Your Experience</h4>
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-400/20">
                                <ShieldCheck className="h-3 w-3" /> Verified Buyer
                              </span>
                            </div>
                            <ReviewForm
                              promptId={itemId}
                              onSubmit={async (review) => {
                                await ReviewClient.submitReview(
                                  itemId,
                                  wallet.address!,
                                  review.rating,
                                  review.text
                                );
                                queryClient.invalidateQueries({ queryKey: ["reviews", itemId] });
                                queryClient.invalidateQueries({ queryKey: ["review-stats", itemId] });
                                queryClient.invalidateQueries({ queryKey: ["review-eligibility", itemId, wallet.address] });
                                setShowReviewForm(false);
                              }}
                              onCancel={() => setShowReviewForm(false)}
                            />
                          </div>
                        )
                      ) : (
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-400">
                          {eligibilityData?.reason || "Only verified buyers with on-chain access can submit reviews."}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={onClose}
                    className="w-full mt-6 h-12 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all"
                  >
                    Back to Marketplace
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reviews Tab */}
        {reviewData && (
          <div className="border-t border-white/10 p-5 sm:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Reviews</h3>
                {reviewData.stats.total > 0 && (
                  <div className="flex items-center gap-3">
                    <StarRating
                      rating={reviewData.stats.averageRating}
                      readonly
                      size="md"
                    />
                    <span className="text-sm text-slate-400">
                      {reviewData.stats.averageRating.toFixed(1)} out of 5
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs text-slate-400">Sort
                  <select value={reviewSort} onChange={(event) => { setReviewSort(event.target.value as ReviewSort); setReviewPage(1); }} className="ml-2 rounded border border-white/10 bg-slate-900 p-2 text-slate-200" aria-label="Sort reviews">
                    <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="helpful">Most helpful</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">Rating
                  <select value={reviewRating ?? ""} onChange={(event) => { setReviewRating(event.target.value ? Number(event.target.value) : undefined); setReviewPage(1); }} className="ml-2 rounded border border-white/10 bg-slate-900 p-2 text-slate-200" aria-label="Filter reviews by rating">
                    <option value="">All ratings</option>{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}
                  </select>
                </label>
              </div>
            </div>
            <ReviewList reviews={reviewData.reviews} isLoading={reviewsLoading} promptId={itemId} currentUserAddress={wallet?.address} onReviewUpdate={() => queryClient.invalidateQueries({ queryKey: ["reviews", itemId] })} />
            {reviewData.pagination.totalPages > 1 && (
              <div className="mt-5 flex items-center justify-between text-sm text-slate-400">
                <span>Page {reviewData.pagination.page} of {reviewData.pagination.totalPages}</span>
                <div className="flex gap-2"><button className="rounded border border-white/10 px-3 py-1 disabled:opacity-40" disabled={reviewPage === 1} onClick={() => setReviewPage((page) => page - 1)}>Previous</button><button className="rounded border border-white/10 px-3 py-1 disabled:opacity-40" disabled={!reviewData.pagination.hasMore} onClick={() => setReviewPage((page) => page + 1)}>Next</button></div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Gift Modal */}
      {showGiftModal && promptData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md">
          <div className="relative max-h-[94vh] w-full max-w-md overflow-y-auto rounded-[28px] border border-white/10 bg-slate-900 shadow-2xl">
            <GiftPrompt
              prompt={{
                id: promptData.id.toString(),
                title: promptData.title,
                priceStroops: promptData.priceStroops,
                imageUrl: promptData.imageUrl,
                category: promptData.category,
                creator: promptData.creator,
                previewText: promptData.previewText,
              }}
              onClose={() => setShowGiftModal(false)}
              onSuccess={() => {
                setShowGiftModal(false);
                onRefresh?.();
              }}
            />
          </div>
        </div>
      )}
    </div>
    </>
  );
};

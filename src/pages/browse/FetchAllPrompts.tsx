import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useQueries,
  useQuery,
  useQueryClient,
  useMutation,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookmarkCheck,
  Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { useDebounce } from "@/hooks/useDebounce";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getAllPrompts,
  hasAccess,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import {
  DEFAULT_MARKETPLACE_MAX_STALE_AGE_MS,
  DEFAULT_MARKETPLACE_STALE_TIME_MS,
  getMarketplaceReadCacheState,
  readMarketplaceReadCache,
  writeMarketplaceReadCache,
} from "@/lib/stellar/marketplaceReadCache";
import {
  fetchSavedPrompts,
  savePromptListing,
  unsavePromptListing,
} from "@/lib/prompts/library";
import { stroopsToXlmString } from "@/lib/stellar/format";
import { PromptCard } from "./PromptCard";
import { PromptModal } from "./PromptModal";
import { ComparisonTray } from "./ComparisonTray";
import { invalidateAllPromptQueries } from "@/hooks/useContractSync";
import { parsePromptIdParam } from "@/lib/marketplace/shareUrls";
import { PromptCardSkeleton } from "@/components/MarketplaceSkeletons";
import { EmptyState } from "@/components/ui/EmptyState";
import { useFavorites } from "@/hooks/useFavorites";
import { useModalShortcut } from "@/providers/KeyboardShortcutsProvider";

const ITEMS_PER_PAGE = 9;
const ENABLE_INFINITE_SCROLL = true;

const isMarketplaceConfigured = Boolean(
  browserStellarConfig.promptHashContractId &&
    browserStellarConfig.simulationAccount &&
    browserStellarConfig.rpcUrl,
);

const parseXlmNumber = (value: bigint) => Number(stroopsToXlmString(value));

export interface FetchAllPromptsProps {
  selectedCategory?: string;
  selectedCategories?: string[];
  selectedTag?: string;
  priceRange?: number[];
  searchQuery?: string;
  creatorQuery?: string;
  sortBy?: string;
  showInactive?: boolean;
}

import { FreshnessBadge } from "@/components/FreshnessBadge";
import { useNetworkState } from "@/hooks/useNetworkState";

const FetchAllPrompts = ({
  selectedCategory,
  selectedCategories,
  selectedTag,
  priceRange = [0, 25],
  searchQuery = "",
  creatorQuery = "",
  sortBy = "recent",
  showInactive = false,
}: FetchAllPromptsProps) => {
  const queryClient = useQueryClient();
  const { address } = useWallet();
  const networkState = useNetworkState();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPrompt, setSelectedPrompt] = useState<PromptRecord | null>(
    null,
  );
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [savingPromptId, setSavingPromptId] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [cachedEntry, setCachedEntry] = useState(() => readMarketplaceReadCache());
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const favorites = useFavorites(address);

  const promptsQuery = useQuery({
    queryKey: ["marketplace-prompts"],
    initialData: cachedEntry?.prompts,
    staleTime: DEFAULT_MARKETPLACE_STALE_TIME_MS,
    gcTime: DEFAULT_MARKETPLACE_MAX_STALE_AGE_MS + 60_000,
    retry: false,
    queryFn: async () => {
      if (!isMarketplaceConfigured) {
        setCacheNotice(null);
        return [];
      }

      try {
        const livePrompts = await getAllPrompts(browserStellarConfig);
        const safePrompts = Array.isArray(livePrompts) ? livePrompts : [];
        const nextCacheEntry = {
          timestamp: Date.now(),
          prompts: safePrompts,
        };

        writeMarketplaceReadCache(safePrompts);
        setCachedEntry(nextCacheEntry);
        setCacheNotice(null);
        return safePrompts;
      } catch (err) {
        const fallbackEntry = readMarketplaceReadCache();
        const fallbackState = getMarketplaceReadCacheState(
          fallbackEntry,
          Date.now(),
          DEFAULT_MARKETPLACE_STALE_TIME_MS,
          DEFAULT_MARKETPLACE_MAX_STALE_AGE_MS,
        );

        if (fallbackState.canServeStaleContent && fallbackState.prompts) {
          const message =
            err instanceof Error
              ? `Showing the last known marketplace listings while the network refresh completes. ${err.message}`
              : "Showing the last known marketplace listings while the network refresh completes.";

          setCachedEntry(fallbackEntry);
          setCacheNotice(message);
          return fallbackState.prompts;
        }

        const message =
          err instanceof Error
            ? err.message
            : "Stellar network connection timed out.";
        setCacheNotice(message);
        throw err;
      }
    },
  });

  const cacheState = useMemo(
    () =>
      getMarketplaceReadCacheState(
        cachedEntry,
        Date.now(),
        DEFAULT_MARKETPLACE_STALE_TIME_MS,
        DEFAULT_MARKETPLACE_MAX_STALE_AGE_MS,
      ),
    [cachedEntry],
  );
  const isUsingCache =
    Boolean(cacheState.useStaleWhileRevalidating) ||
    Boolean(cacheNotice && cachedEntry) ||
    !networkState.isOnline ||
    (promptsQuery.isSuccess && !promptsQuery.isFetchedAfterMount);
  const freshnessTimestamp = promptsQuery.dataUpdatedAt || cachedEntry?.timestamp || null;

  const savedPromptsQuery = useQuery({
    queryKey: ["saved-prompts", address],
    queryFn: async () => (address ? fetchSavedPrompts(address) : []),
    enabled: Boolean(address),
  });

  const savePromptMutation = useMutation({
    mutationFn: async ({
      promptId,
      saved,
    }: {
      promptId: string;
      saved: boolean;
    }) => {
      if (!address) {
        throw new Error("Connect your wallet before saving listings.");
      }

      if (saved) {
        await unsavePromptListing(address, promptId);
      } else {
        await savePromptListing(address, promptId);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saved-prompts"] });
    },
  });

  const accessQueries = useQueries({
    queries: (address ? (promptsQuery.data ?? []) : []).map((prompt) => ({
      queryKey: ["prompt-access", address, prompt.id.toString()],
      queryFn: async () =>
        hasAccess(browserStellarConfig, address!, prompt.id.toString()),
      staleTime: 15_000,
    })),
  });

  const accessMap = useMemo(() => {
    return new Map(
      (promptsQuery.data ?? []).map((prompt, index) => [
        prompt.id.toString(),
        address
          ? (accessQueries[index]?.data ?? prompt.creator === address)
          : false,
      ]),
    );
  }, [accessQueries, address, promptsQuery.data]);

  const savedPromptIds = useMemo(() => {
    return new Set((savedPromptsQuery.data ?? []).map((item) => item.promptId));
  }, [savedPromptsQuery.data]);

  const handleToggleSave = async (prompt: PromptRecord) => {
    if (!address) {
      return;
    }

    const promptId = prompt.id.toString();
    setSavingPromptId(promptId);
    try {
      await savePromptMutation.mutateAsync({
        promptId,
        saved: savedPromptIds.has(promptId),
      });
    } finally {
      setSavingPromptId(null);
    }
  };

  const handleToggleFavorite = (prompt: PromptRecord) => {
    favorites.toggle(prompt.id.toString());
  };

  const isFavorited = (promptId: string) => favorites.isFavorite(promptId);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const debouncedCreatorQuery = useDebounce(creatorQuery, 300);

  const filteredPrompts = useMemo(() => {
    const normalizedSearch = debouncedSearchQuery.trim().toLowerCase();
    const allPrompts = promptsQuery.data ?? [];

    // When favorites-only is active, show ALL favorited prompts (including inactive)
    if (showFavoritesOnly && address) {
      const favIds = favorites.favorites;
      return allPrompts
        .filter((prompt) => favIds.includes(prompt.id.toString()))
        .sort((a, b) => Number(b.id - a.id));
    }

    const prompts = allPrompts.filter((prompt) => {
      const promptPrice = parseXlmNumber(prompt.priceStroops);
      const normalizedCreator = debouncedCreatorQuery.trim().toLowerCase();
      const matchesCategory =
        !selectedCategories || selectedCategories.length === 0
          ? !selectedCategory || prompt.category === selectedCategory
          : selectedCategories.some(
              (cat) => cat.toLowerCase() === prompt.category.toLowerCase(),
            );
      const matchesTag =
        !selectedTag ||
        prompt.tags?.some(
          (tag) => tag.toLowerCase() === selectedTag.toLowerCase(),
        );
      const matchesSearch =
        !normalizedSearch ||
        prompt.title.toLowerCase().includes(normalizedSearch) ||
        prompt.category.toLowerCase().includes(normalizedSearch) ||
        prompt.previewText.toLowerCase().includes(normalizedSearch) ||
        (prompt.description ?? "").toLowerCase().includes(normalizedSearch) ||
        prompt.creator.toLowerCase().includes(normalizedSearch) ||
        prompt.tags?.some((tag) => tag.toLowerCase().includes(normalizedSearch));
      const matchesCreator =
        !normalizedCreator ||
        prompt.creator.toLowerCase().includes(normalizedCreator);
      const matchesPrice =
        promptPrice >= priceRange[0] && promptPrice <= priceRange[1];
      const matchesActive = showInactive || prompt.active;

      return (
        matchesActive &&
        matchesCategory &&
        matchesTag &&
        matchesSearch &&
        matchesCreator &&
        matchesPrice
      );
    });

    switch (sortBy) {
      case "price-low":
        return [...prompts].sort((a, b) =>
          a.priceStroops < b.priceStroops ? -1 : 1,
        );
      case "price-high":
        return [...prompts].sort((a, b) =>
          a.priceStroops > b.priceStroops ? -1 : 1,
        );
      case "sales":
        return [...prompts].sort((a, b) => b.salesCount - a.salesCount);
      case "ending-soon":
        return [...prompts].sort((a, b) => {
          const aTime = a.activePromotion?.endTime ?? 0;
          const bTime = b.activePromotion?.endTime ?? 0;
          if (aTime === bTime) return Number(b.id - a.id);
          return aTime - bTime;
        });
      case "bookmarked":
        // Bookmarked (saved) prompts first, newest-first within each group.
        return [...prompts].sort((a, b) => {
          const aSaved = savedPromptIds.has(a.id.toString()) ? 1 : 0;
          const bSaved = savedPromptIds.has(b.id.toString()) ? 1 : 0;
          if (aSaved !== bSaved) return bSaved - aSaved;
          return Number(b.id - a.id);
        });
      default:
        return [...prompts].sort((a, b) => Number(b.id - a.id));
    }
  }, [priceRange, promptsQuery.data, debouncedSearchQuery, debouncedCreatorQuery, selectedCategories, selectedCategory, sortBy, showInactive, savedPromptIds]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPrompts.length / ITEMS_PER_PAGE),
  );

  // Infinite scroll observer: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    if (
      !ENABLE_INFINITE_SCROLL ||
      !loadMoreRef.current ||
      currentPage >= totalPages
    )
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && currentPage < totalPages) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: "100px" },
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [currentPage, totalPages]);
  
  // For infinite scroll, show all items up to current page
  const currentPrompts = ENABLE_INFINITE_SCROLL
    ? filteredPrompts.slice(0, currentPage * ITEMS_PER_PAGE)
    : filteredPrompts.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE,
      );

  useEffect(() => {
    setCurrentPage(1);
  }, [priceRange, searchQuery, creatorQuery, selectedCategories, selectedCategory, selectedTag, sortBy, showInactive]);

  useEffect(() => {
    if (!promptsQuery.data) return;

    const params = new URLSearchParams(window.location.search);
    const promptId = params.get("promptId");
    if (!promptId) return;

    const match = promptsQuery.data.find((prompt) => prompt.id.toString() === promptId);
    if (match) {
      setSelectedPrompt(match);
    }
  }, [promptsQuery.data]);
  // Support shareable browse deep links: /browse?prompt=<id>
  useEffect(() => {
    const promptParam = searchParams.get("prompt");
    if (!promptParam) {
      setDeepLinkError(null);
      return;
    }

    const parsed = parsePromptIdParam(promptParam);
    if (!parsed.ok) {
      setDeepLinkError(parsed.error);
      setSelectedPrompt(null);
      return;
    }

    const prompts = promptsQuery.data;
    if (!prompts) {
      return;
    }

    const match = prompts.find((prompt) => prompt.id.toString() === parsed.promptId);
    if (!match) {
      setDeepLinkError(
        `Prompt #${parsed.promptId} was not found in the current marketplace catalog.`,
      );
      setSelectedPrompt(null);
      return;
    }

    setDeepLinkError(null);
    setSelectedPrompt(match);
  }, [promptsQuery.data, searchParams]);

  const openPromptModal = (prompt: PromptRecord) => {
    setDeepLinkError(null);
    setSelectedPrompt(prompt);
    const next = new URLSearchParams(searchParams);
    next.set("prompt", prompt.id.toString());
    setSearchParams(next, { replace: true });
  };

  const closePromptModal = () => {
    setSelectedPrompt(null);
    if (searchParams.has("prompt")) {
      const next = new URLSearchParams(searchParams);
      next.delete("prompt");
      setSearchParams(next, { replace: true });
    }
  };

  useModalShortcut("prompt", closePromptModal, !!selectedPrompt);

  if (promptsQuery.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <PromptCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (promptsQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center p-12 rounded-3xl border border-red-500/20 bg-red-500/5 text-center">
        <p className="text-red-400 font-medium mb-2">Sync Error</p>
        <p className="text-sm text-slate-400">
          {promptsQuery.error instanceof Error
            ? promptsQuery.error.message
            : "Stellar network connection timed out."}
        </p>
        <Button
          variant="link"
          className="mt-4 text-emerald-400"
          onClick={() => promptsQuery.refetch()}
        >
          Try Reconnecting
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <FreshnessBadge
            timestamp={freshnessTimestamp}
            isCached={isUsingCache}
            isOffline={!networkState.isOnline}
            isDegraded={Boolean(cacheNotice) || networkState.isDegraded}
          />
          {cacheNotice && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {cacheNotice}
            </div>
          )}
        </div>
        {address && (
          <button
            onClick={() => setShowFavoritesOnly((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              showFavoritesOnly
                ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                : "bg-slate-500/10 border-slate-500/20 text-slate-400 hover:text-white"
            }`}
            aria-label={showFavoritesOnly ? "Show all prompts" : "Show favorites only"}
            aria-pressed={showFavoritesOnly}
          >
            <Heart className={`h-3.5 w-3.5 ${showFavoritesOnly ? "fill-rose-400 text-rose-400" : ""}`} />
            {favorites.count > 0 ? `${favorites.count} favorited` : "Favorites"}
          </button>
        )}
        {savedPromptIds.size > 0 && !showFavoritesOnly && (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
            <BookmarkCheck className="h-3.5 w-3.5" />
            {savedPromptIds.size} bookmarked
          </div>
        )}
        {!networkState.canTrustConfirmation && (
          <div className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg">
            Read-Only Mode — On-chain actions disabled until network connection is stable
          </div>
        )}
      </div>

      {!isMarketplaceConfigured && (
        <div className="mb-8 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm flex gap-3 items-center">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Contract config missing. Connect a network to view live listings.
        </div>
      )}

      {deepLinkError && (
        <div
          role="alert"
          className="mb-8 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {deepLinkError}
        </div>
      )}

      {filteredPrompts.length === 0 ? (
        showFavoritesOnly ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Heart className="h-12 w-12 text-rose-400/50 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">No favorites yet</h3>
            <p className="text-sm text-slate-400 max-w-md">
              Browse the marketplace and click the heart icon on prompts you'd like to save.
              Your favorites follow your wallet across devices.
            </p>
          </div>
        ) : (
          <EmptyState
            variant={searchQuery || selectedCategory || selectedCategories?.length || selectedTag || creatorQuery || showInactive ? "search-empty" : "no-results"}
            title={searchQuery || selectedCategory || selectedCategories?.length || selectedTag || creatorQuery || showInactive ? "No matching prompts" : "No prompts found"}
            description={
              searchQuery || selectedCategory || selectedCategories?.length || selectedTag || creatorQuery || showInactive
                ? "Try adjusting your filters or search terms to find what you're looking for."
                : "The marketplace has no active listings at the moment. Check back soon."
            }
            size="lg"
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
            {currentPrompts.map((prompt) => (
              <PromptCard
                key={prompt.id.toString()}
                prompt={prompt}
                hasAccess={accessMap.get(prompt.id.toString()) ?? false}
                openModal={openPromptModal}
                isSaved={savedPromptIds.has(prompt.id.toString())}
                isSaving={savingPromptId === prompt.id.toString()}
                onToggleSave={handleToggleSave}
                isFavorited={isFavorited(prompt.id.toString())}
                onToggleFavorite={address ? handleToggleFavorite : undefined}
              />
            ))}
          </div>

          {/* Infinite Scroll Trigger */}
          {ENABLE_INFINITE_SCROLL && currentPage < totalPages && (
            <div
              ref={loadMoreRef}
              className="mt-12 flex items-center justify-center py-8"
            >
              <div className="flex items-center gap-3 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading more prompts...</span>
              </div>
            </div>
          )}

          {/* Show count indicator for infinite scroll */}
          {ENABLE_INFINITE_SCROLL && filteredPrompts.length > ITEMS_PER_PAGE && (
            <div className="mt-8 text-center">
              <p className="text-sm text-slate-500">
                Showing <span className="text-white font-semibold">{currentPrompts.length}</span> of{" "}
                <span className="text-white font-semibold">{filteredPrompts.length}</span> prompts
              </p>
            </div>
          )}
        </>
      )}

      {/* Traditional Pagination (fallback when infinite scroll disabled) */}
      {!ENABLE_INFINITE_SCROLL && filteredPrompts.length > ITEMS_PER_PAGE && (
        <div className="mt-16 flex items-center justify-center gap-6">
          <Button
            variant="ghost"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="text-slate-400 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5 mr-2" /> Previous
          </Button>
          <span className="text-sm font-medium text-slate-500 uppercase tracking-widest">
            Page <span className="text-white">{currentPage}</span> /{" "}
            {totalPages}
          </span>
          <Button
            variant="ghost"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="text-slate-400 hover:text-white"
          >
            Next <ChevronRight className="h-5 w-5 ml-2" />
          </Button>
        </div>
      )}

      {selectedPrompt && (
        <PromptModal
          itemId={selectedPrompt.id.toString()}
          isOpen={!!selectedPrompt}
          onClose={closePromptModal}
          onRefresh={() => invalidateAllPromptQueries(queryClient)}
        />
      )}

      {/* #277 – floating comparison tray */}
      <ComparisonTray />
    </>
  );
};

export default FetchAllPrompts;

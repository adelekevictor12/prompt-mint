import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, GripVertical, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CreatorDashboard } from "@/components/sell/CreatorDashboard";
import { TransactionHistoryPanel } from "@/components/dashboard/TransactionHistoryPanel";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  getPromptsByBuyer,
  getPromptsByCreator,
  setPromptSaleStatus,
  updatePromptPrice,
} from "@/lib/stellar/promptHashClient";
import { formatPriceLabel, stroopsToXlmString, xlmToStroops } from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";
import { getPromptOrder, setPromptOrder } from "@/lib/prompts/promptOrderClient";

import { FreshnessBadge } from "@/components/FreshnessBadge";
import { useNetworkState } from "@/hooks/useNetworkState";
import { type PromptRecord } from "@/lib/stellar/promptHashClient";
import { SkeletonCard } from "@/components/Skeleton";
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { runBatchOperation } from "@/lib/marketplace/batchOperations";

const emptyState = (
  <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
    No prompts found yet.
  </div>
);

interface MyPromptsProps {
  onCreateNew?: () => void;
}

interface CachedPromptsList {
  timestamp: number;
  prompts: PromptRecord[];
}

function getCachedCreatorPrompts(address?: string): CachedPromptsList | null {
  if (!address) return null;
  try {
    const raw = window.localStorage.getItem(`prompt-mint:created-prompts-cache:${address}`);
    if (raw) return JSON.parse(raw);
  } catch { /* empty */ }
  return null;
}

function setCachedCreatorPrompts(address: string, prompts: PromptRecord[]) {
  try {
    window.localStorage.setItem(
      `prompt-mint:created-prompts-cache:${address}`,
      JSON.stringify({ timestamp: Date.now(), prompts }),
    );
  } catch { /* empty */ }
}

const MyPrompts = ({ onCreateNew: _onCreateNew }: MyPromptsProps) => {
  void _onCreateNew;

  const queryClient = useQueryClient();
  const { address, signMessage, signTransaction } = useWallet();
  const networkState = useNetworkState();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [unlockedPrompts, setUnlockedPrompts] = useState<Record<string, string>>({});
  const selection = useMultiSelect();
  const [bulkPrice, setBulkPrice] = useState("");
  const [batchProgress, setBatchProgress] = useState<{
    running: boolean;
    completed: number;
    total: number;
    label: string;
  } | null>(null);

  const createdQuery = useQuery({
    queryKey: ["created-prompts", address],
    queryFn: async () => {
      if (!address) return [];
      try {
        const live = await getPromptsByCreator(browserStellarConfig, address);
        if (live && live.length > 0) {
          setCachedCreatorPrompts(address, live);
        }
        return live;
      } catch (err) {
        const cached = getCachedCreatorPrompts(address);
        if (cached && cached.prompts.length > 0) return cached.prompts;
        throw err;
      }
    },
    enabled: Boolean(address),
  });

  const cachedCreatorData = getCachedCreatorPrompts(address);
  const createdPrompts = createdQuery.data ?? cachedCreatorData?.prompts ?? [];
  const isUsingCache = createdQuery.isError || !networkState.isOnline || (createdQuery.isSuccess && !createdQuery.isFetchedAfterMount);
  const freshnessTimestamp = createdQuery.dataUpdatedAt || cachedCreatorData?.timestamp || null;

  const purchasedQuery = useQuery({
    queryKey: ["purchased-prompts", address],
    queryFn: async () =>
      address ? getPromptsByBuyer(browserStellarConfig, address) : [],
    enabled: Boolean(address),
  });

  const purchasedPrompts = purchasedQuery.data ?? [];

  const orderQuery = useQuery({
    queryKey: ["prompt-order", address],
    queryFn: () => (address ? getPromptOrder(address) : Promise.resolve([])),
    enabled: Boolean(address),
  });

  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    setLocalOrder(null);
    setDraggedId(null);
  }, [address]);

  const orderedCreatedPrompts = useMemo(() => {
    const savedOrder = localOrder ?? orderQuery.data ?? [];
    const byId = new Map(createdPrompts.map((prompt) => [prompt.id.toString(), prompt]));
    const known = savedOrder.filter((id) => byId.has(id));
    const missing = createdPrompts
      .map((prompt) => prompt.id.toString())
      .filter((id) => !known.includes(id));
    return [...known, ...missing].map((id) => byId.get(id)!);
  }, [createdPrompts, localOrder, orderQuery.data]);

  const persistPromptOrder = async (order: string[]) => {
    if (!address) return;
    try {
      const saved = await setPromptOrder(address, order);
      queryClient.setQueryData(["prompt-order", address], saved);
      setLocalOrder(null);
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to save prompt order.");
    }
  };

  const handlePromptDragStart = (promptId: string) => (event: DragEvent) => {
    setDraggedId(promptId);
    event.dataTransfer.effectAllowed = "move";
  };

  const handlePromptDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handlePromptDrop = (targetId: string) => (event: DragEvent) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }

    const currentOrder = orderedCreatedPrompts.map((prompt) => prompt.id.toString());
    const fromIndex = currentOrder.indexOf(draggedId);
    const toIndex = currentOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedId(null);
      return;
    }

    const nextOrder = [...currentOrder];
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, draggedId);

    setLocalOrder(nextOrder);
    setDraggedId(null);
    void persistPromptOrder(nextOrder);
  };

  const mergedDrafts = useMemo(() => {
    return Object.fromEntries(
      createdPrompts.map((prompt) => [
        prompt.id.toString(),
        priceDrafts[prompt.id.toString()] ?? stroopsToXlmString(prompt.priceStroops),
      ]),
    );
  }, [createdPrompts, priceDrafts]);

  const dashboardStats = useMemo(() => {
    const totalSales = createdPrompts.reduce((sum, p) => sum + (p.salesCount ?? 0), 0);
    const totalRevenue = createdPrompts.reduce(
      (sum, p) => sum + (p.priceStroops * BigInt(p.salesCount ?? 0)),
      BigInt(0),
    );
    const activeListings = createdPrompts.filter((p) => p.active).length;

    return {
      totalListings: createdPrompts.length,
      totalSales,
      totalRevenue: stroopsToXlmString(totalRevenue),
      activeListings,
    };
  }, [createdPrompts]);

  const refreshPromptLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["created-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["purchased-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["marketplace-prompts"] }),
      queryClient.invalidateQueries({ queryKey: ["prompt-access"] }),
      // #507: detail views and the cart cache read price from separate keys and
      // must be refreshed too, otherwise the old price lingers after an update.
      queryClient.invalidateQueries({ queryKey: ["prompt-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["marketplace-prompts-cache"] }),
    ]);
  };

  const updateStatus = (message: string) => {
    setErrorMessage(null);
    setStatusMessage(message);
  };

  const updateError = (message: string) => {
    setStatusMessage(null);
    setErrorMessage(message);
  };

  const handleToggleSaleStatus = async (promptId: bigint, active: boolean) => {
    if (!networkState.canTrustConfirmation) {
      updateError("Network connection lost or degraded. Status changes are disabled.");
      return;
    }
    if (!address || !signTransaction) {
      updateError("Connect a wallet before changing prompt status.");
      return;
    }

    setBusyPromptId(promptId.toString());
    try {
      await setPromptSaleStatus(
        browserStellarConfig,
        { signTransaction },
        address,
        promptId.toString(),
        !active,
      );
      updateStatus(!active ? "Prompt reactivated." : "Prompt deactivated.");
      await refreshPromptLists();
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to update sale status.");
    } finally {
      setBusyPromptId(null);
    }
  };

  const handleUpdatePrice = async (promptId: bigint) => {
    if (!networkState.canTrustConfirmation) {
      updateError("Network connection lost or degraded. Price updates are disabled.");
      return;
    }
    if (!address || !signTransaction) {
      updateError("Connect a wallet before updating prompt prices.");
      return;
    }


    setBusyPromptId(promptId.toString());
    try {
      const nextPrice = xlmToStroops(mergedDrafts[promptId.toString()]);
      await updatePromptPrice(
        browserStellarConfig,
        { signTransaction },
        address,
        promptId.toString(),
        nextPrice.toString(),
      );
      updateStatus("Prompt price updated.");
      await refreshPromptLists();
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to update price.");
    } finally {
      setBusyPromptId(null);
    }
  };

  const canMutate = () => {
    if (!networkState.canTrustConfirmation) {
      updateError("Network connection lost or degraded. Batch actions are disabled.");
      return false;
    }
    if (!address || !signTransaction) {
      updateError("Connect a wallet before running batch actions.");
      return false;
    }
    return true;
  };

  const runBatch = async (
    label: string,
    operation: (promptId: string) => Promise<void>,
  ) => {
    const ids = selection.selectedIds;
    if (ids.length === 0 || !canMutate()) return;

    setBatchProgress({ running: true, completed: 0, total: ids.length, label });
    try {
      const summary = await runBatchOperation(ids, operation, (progress) => {
        setBatchProgress({
          running: true,
          completed: progress.completed,
          total: progress.total,
          label,
        });
      });
      await refreshPromptLists();
      if (summary.failureCount === 0) {
        updateStatus(`${label}: ${summary.successCount} listing(s) updated.`);
        selection.clear();
      } else {
        updateError(
          `${label}: ${summary.successCount} succeeded, ${summary.failureCount} failed.`,
        );
      }
    } finally {
      setBatchProgress(null);
    }
  };

  const handleBatchUpdatePrice = async () => {
    if (!bulkPrice.trim()) {
      updateError("Enter a price to apply to the selected listings.");
      return;
    }
    let nextPrice: bigint;
    try {
      nextPrice = xlmToStroops(bulkPrice);
    } catch {
      updateError("Invalid price. Enter a valid XLM amount.");
      return;
    }
    await runBatch("Bulk price update", async (promptId) => {
      await updatePromptPrice(
        browserStellarConfig,
        { signTransaction: signTransaction! },
        address!,
        promptId,
        nextPrice.toString(),
      );
    });
  };

  const handleBatchSetActive = async (active: boolean) => {
    const label = active ? "Bulk reactivate" : "Bulk delist";
    await runBatch(label, async (promptId) => {
      await setPromptSaleStatus(
        browserStellarConfig,
        { signTransaction: signTransaction! },
        address!,
        promptId,
        active,
      );
    });
  };

  const handleUnlock = async (promptId: bigint) => {
    if (!address || !signMessage) {
      updateError("Connect a wallet with SEP-43 message signing to unlock prompts.");
      return;
    }

    setBusyPromptId(promptId.toString());
    try {
      const response = await unlockPromptContent(address, promptId.toString(), signMessage);
      setUnlockedPrompts((current) => ({
        ...current,
        [promptId.toString()]: response.plaintext,
      }));
      updateStatus("Prompt unlocked.");
    } catch (error) {
      updateError(error instanceof Error ? error.message : "Failed to unlock prompt.");
    } finally {
      setBusyPromptId(null);
    }
  };

  if (!address) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-sm text-slate-300">
        Connect your Stellar wallet to manage created and purchased prompts.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <CreatorDashboard
        stats={dashboardStats}
        isLoading={createdQuery.isLoading}
        isError={createdQuery.isError}
        onRefresh={refreshPromptLists}
      />

      {address ? (
        <TransactionHistoryPanel
          walletAddress={address}
          role="creator"
          title="Sales history"
          description="Recent purchases of your listings, sourced from indexed on-chain events and recorded license claims."
          emptyMessage="No sales recorded yet. When buyers purchase your prompts, transactions appear here."
        />
      ) : null}

      {statusMessage ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-white">Created by me</h2>
            <p className="mt-2 text-sm text-slate-400">
              Update pricing, pause listings, and track license sales without changing ownership.
            </p>
          </div>
          <FreshnessBadge
            timestamp={freshnessTimestamp}
            isCached={isUsingCache}
            isOffline={!networkState.isOnline}
            isDegraded={networkState.isDegraded}
          />
        </div>

        {createdPrompts.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <label className="flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-400"
                aria-label="Select all listings"
                checked={selection.isAllSelected(
                  createdPrompts.map((p) => p.id.toString()),
                )}
                onChange={(event) => {
                  if (event.target.checked) {
                    selection.selectAll(createdPrompts.map((p) => p.id.toString()));
                  } else {
                    selection.clear();
                  }
                }}
              />
              Select all
            </label>
            <span className="text-slate-400">
              {selection.selectedCount} selected
            </span>
          </div>
        ) : null}

        {selection.selectedCount > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
            <span className="text-sm font-medium text-emerald-100">
              Batch actions ({selection.selectedCount})
            </span>
            <div className="flex items-center gap-2">
              <Input
                value={bulkPrice}
                onChange={(event) => setBulkPrice(event.target.value)}
                placeholder="New price (XLM)"
                className="w-36 border-white/10 bg-white/5 text-slate-100"
                aria-label="Bulk price in XLM"
              />
              <Button
                size="sm"
                className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                onClick={() => void handleBatchUpdatePrice()}
                disabled={batchProgress?.running || !networkState.canTrustConfirmation}
              >
                Apply price
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
              onClick={() => void handleBatchSetActive(false)}
              disabled={batchProgress?.running || !networkState.canTrustConfirmation}
            >
              Delist selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
              onClick={() => void handleBatchSetActive(true)}
              disabled={batchProgress?.running || !networkState.canTrustConfirmation}
            >
              Reactivate selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-slate-300 hover:text-white"
              onClick={() => selection.clear()}
              disabled={batchProgress?.running}
            >
              Clear
            </Button>
            {batchProgress?.running ? (
              <span className="flex items-center gap-2 text-xs text-emerald-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {batchProgress.label}: {batchProgress.completed}/{batchProgress.total}
              </span>
            ) : null}
          </div>
        ) : null}

        {createdQuery.isLoading ? (
          <div className="grid gap-6 xl:grid-cols-2" role="status" aria-label="Loading created prompts">
            {[...Array(2)].map((_, i) => (
              <SkeletonCard key={i} lines={3} className="h-full" />
            ))}
          </div>
        ) : orderedCreatedPrompts.length === 0 ? (
          emptyState
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {orderedCreatedPrompts.map((prompt) => (
              <Card
                key={prompt.id.toString()}
                draggable
                onDragStart={handlePromptDragStart(prompt.id.toString())}
                onDragOver={handlePromptDragOver}
                onDrop={handlePromptDrop(prompt.id.toString())}
                onDragEnd={() => setDraggedId(null)}
                className={`relative border-white/10 bg-slate-950/70 text-white transition-opacity ${
                  draggedId === prompt.id.toString() ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-2 px-5 pt-4 text-slate-500">
                  <GripVertical
                    className="h-4 w-4 cursor-grab active:cursor-grabbing"
                    aria-label="Drag to reorder"
                  />
                  <span className="text-xs uppercase tracking-[0.2em]">Drag to reorder</span>
                </div>
                <label className="absolute left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-white/20 bg-slate-950/70 backdrop-blur">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-400"
                    aria-label={`Select ${prompt.title}`}
                    checked={selection.isSelected(prompt.id.toString())}
                    onChange={() => selection.toggle(prompt.id.toString())}
                  />
                </label>
                <div className="aspect-video overflow-hidden rounded-t-xl">
                  <img
                    src={prompt.imageUrl || "/images/codeguru.png"}
                    alt={prompt.title}
                    className="h-full w-full object-cover"
                  />
                </div>
                <CardContent className="space-y-4 p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                      {prompt.category}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {prompt.previewText}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Sales
                      </p>
                      <p className="mt-2 font-medium text-slate-100">
                        {prompt.salesCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Status
                      </p>
                      <p className="mt-2 font-medium text-slate-100">
                        {prompt.active ? "Active" : "Inactive"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Input
                      value={mergedDrafts[prompt.id.toString()]}
                      onChange={(event) =>
                        setPriceDrafts((current) => ({
                          ...current,
                          [prompt.id.toString()]: event.target.value,
                        }))
                      }
                      className="border-white/10 bg-white/5 text-slate-100"
                      aria-label={`Price in XLM for ${prompt.title}`}
                    />
                    <Button
                      className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                      onClick={() => void handleUpdatePrice(prompt.id)}
                      disabled={busyPromptId === prompt.id.toString() || !networkState.canTrustConfirmation}
                    >
                      Update price
                    </Button>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between p-5 pt-0">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                      Current price
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-100">
                      {formatPriceLabel(prompt.priceStroops)} XLM
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                    onClick={() => void handleToggleSaleStatus(prompt.id, prompt.active)}
                    disabled={busyPromptId === prompt.id.toString() || !networkState.canTrustConfirmation}
                  >
                    {prompt.active ? "Set inactive" : "Reactivate"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Purchased by me</h2>
          <p className="mt-2 text-sm text-slate-400">
            Unlock purchased prompt text on demand. Access remains available for future sessions.
          </p>
        </div>

        {purchasedQuery.isLoading ? (
          <div className="grid gap-6 xl:grid-cols-2" role="status" aria-label="Loading purchased prompts">
            {[...Array(2)].map((_, i) => (
              <SkeletonCard key={i} withMedia={false} lines={3} className="h-full" />
            ))}
          </div>
        ) : purchasedPrompts.length === 0 ? (
          emptyState
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {purchasedPrompts.map((prompt) => (
              <Card
                key={prompt.id.toString()}
                className="border-white/10 bg-slate-950/70 text-white"
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                        {prompt.category}
                      </p>
                      <h3 className="mt-2 text-xl font-semibold">{prompt.title}</h3>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm">
                      {formatPriceLabel(prompt.priceStroops)} XLM
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-slate-300">
                    {prompt.previewText}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                      onClick={() => void handleUnlock(prompt.id)}
                      disabled={busyPromptId === prompt.id.toString()}
                    >
                      {busyPromptId === prompt.id.toString() ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Unlocking...
                        </>
                      ) : (
                        <>
                          <LockKeyhole className="mr-2 h-4 w-4" />
                          Unlock prompt
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      className="border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                      onClick={() => void handleUnlock(prompt.id)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Re-open
                    </Button>
                  </div>
                  {unlockedPrompts[prompt.id.toString()] ? (
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                      <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
                        {unlockedPrompts[prompt.id.toString()]}
                      </pre>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
                      Unlocked plaintext appears here after the access check succeeds.
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default MyPrompts;

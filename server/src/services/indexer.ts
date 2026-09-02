import { scValToNative } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import Prompt from "../models/Prompt";
import Purchase from "../models/Purchase";
import User from "../models/User";
import { IndexerState } from "../models/IndexerState";
import { scanForSimilarity } from "./similarityDetection";
import { recordMarketplaceTransaction } from "./transactionHistoryService";
import { invalidatePromptMetadata } from "./cacheService";
import { dispatchEvent } from "./webhookDispatcher";
import { notifyPromptPurchased } from "./emailNotifications";

const CONTRACT_ID = process.env.PUBLIC_PROMPT_HASH_CONTRACT_ID;
const rpc = new Server(process.env.PUBLIC_STELLAR_RPC_URL!, { timeout: 15_000 });

/**
 * Main entry point to start the background indexing process.
 */
export async function startIndexer() {
  const INDEXER_START_LEDGER = parseInt(process.env.INDEXER_START_LEDGER || "0", 10);
  const state = await IndexerState.findOneAndUpdate(
    { key: "prompt_hash_contract" },
    { $setOnInsert: { lastIndexedLedger: 0 } },
    { upsert: true, new: true },
  );

  // Poll every 5 seconds
  setInterval(async () => {
    try {
      const latestLedger = await rpc.getLatestLedger();
      const startLedger = state.lastIndexedLedger
        ? state.lastIndexedLedger + 1
        : Math.max(1, INDEXER_START_LEDGER);

      if (startLedger > latestLedger.sequence) return;

      const BATCH_SIZE = 2000;
      let currentLedger = startLedger;

      while (currentLedger <= latestLedger.sequence) {
        const batchEnd = Math.min(currentLedger + BATCH_SIZE - 1, latestLedger.sequence);
        const response = await rpc.getEvents({
          startLedger: currentLedger,
          filters: [
            {
              type: "contract",
              contractIds: [CONTRACT_ID!],
            },
          ],
        });

        for (const event of response.events) {
          await processEvent(event);
        }

        currentLedger = batchEnd + 1;
      }

      state.lastIndexedLedger = latestLedger.sequence;
      await state.save();
    } catch (err) {
      console.error("Indexer Error:", err);
    }
  }, 5000);
}

/**
 * Decodes and routes Soroban events to the appropriate database action.
 */
async function processEvent(event: any) {
  // Decode the topic and value from XDR to Native JS types
  const topic = scValToNative(event.topic[0]);
  const data = scValToNative(event.value);

  console.log(`Processing Event: ${topic}`, data);

  switch (topic) {
    case "PromptCreated": {
      const { prompt_id, creator, price_stroops } = data;

      // Ensure the creator exists in our User collection
      let user = await User.findOne({ walletAddress: creator.toLowerCase() });
      if (!user) {
        user = await User.create({
          walletAddress: creator.toLowerCase(),
          username: `user_${creator.slice(0, 6)}`,
          rating: 4,
        });
      }

      // handles discovery of prompts created off-platform
      const upserted = await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        {
          $set: {
            onChainId: prompt_id.toString(),
            owner: user._id,
            price: Number(price_stroops) / 10_000_000,
            isActive: true,
          },
        },
        { upsert: true, new: true },
      );

      // Run similarity scan asynchronously — never block the indexer loop.
      if (upserted?.content) {
        const combinedText = `${upserted.title ?? ""} ${upserted.content}`;
        scanForSimilarity(prompt_id.toString(), combinedText).catch((err) =>
          console.error("[similarity] Scan error for prompt", prompt_id.toString(), err),
        );
      }
      await invalidatePromptMetadata(String(upserted?._id ?? prompt_id));

      void dispatchEvent(creator, "PromptCreated", {
        prompt_id,
        creator,
        price_stroops,
      }).catch((err) =>
        console.error("[indexer] PromptCreated webhook dispatch failed:", err),
      );
      break;
    }

    case "PromptPurchased": {
      const { prompt_id, buyer, creator } = data;
      const updatedPrompt = await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $inc: { salesCount: 1 } },
        { new: true },
      );
      if (buyer && event.txHash) {
        await Purchase.updateOne(
          {
            promptId: prompt_id.toString(),
            buyerWallet: buyer.toLowerCase(),
          },
          {
            $setOnInsert: {
              versionIndex: 1,
              txHash: event.txHash,
            },
          },
          { upsert: true },
        );
      }
      await invalidatePromptMetadata(String(updatedPrompt?._id ?? prompt_id));

      if (buyer && creator) {
        void dispatchEvent(creator, "PromptPurchased", {
          prompt_id,
          buyer,
          creator,
          txHash: event.txHash,
        }).catch((err) =>
          console.error("[indexer] PromptPurchased webhook dispatch failed:", err),
        );

        const prompt = await Prompt.findOne({
          onChainId: prompt_id.toString(),
        }).lean();
        void notifyPromptPurchased(creator, {
          buyerWallet: buyer,
          promptTitle: prompt?.title ?? `Prompt #${prompt_id}`,
          promptId: prompt_id.toString(),
          txHash: event.txHash,
        }).catch((err) =>
          console.error("[indexer] PromptPurchased email notification failed:", err),
        );
      }
      break;
    }

    case "PromptPriceUpdated": {
      const { prompt_id, price_stroops } = data;
      const updatedPrompt = await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { price: Number(price_stroops) / 10_000_000 } },
        { new: true },
      );
      await invalidatePromptMetadata(String(updatedPrompt?._id ?? prompt_id));

      const prompt = await Prompt.findOne({
        onChainId: prompt_id.toString(),
      }).lean();
      const creator = prompt?.owner?.walletAddress ?? "";
      void dispatchEvent(creator, "PromptPriceUpdated", {
        prompt_id,
        price_stroops,
      }).catch((err) =>
        console.error("[indexer] PromptPriceUpdated webhook dispatch failed:", err),
      );
      break;
    }

    case "PromptSaleStatusUpdated": {
      const { prompt_id, active } = data;
      const updatedPrompt = await Prompt.findOneAndUpdate(
        { onChainId: prompt_id.toString() },
        { $set: { isActive: active } },
        { new: true },
      );
      await invalidatePromptMetadata(String(updatedPrompt?._id ?? prompt_id));
      break;
    }

    default:
      console.log(`Unhandled event topic: ${topic}`);
      break;
  }
}

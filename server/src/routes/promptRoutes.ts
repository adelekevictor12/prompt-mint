import express from "express";
import {
  CreatePrompt,
  GetPrompts,
  GetPromptDetail,
  GetOwnedPrompts,
  GetSavedPrompts,
  SavePrompt,
  UnsavePrompt,
  GetDraftPrompts,
  PublishPrompt,
  ArchivePrompt,
  SubmitForReview,
  UpdateReviewChecklist,
  AddTags,
  RemoveTags,
  GetMarketplaceIndexStatus,
  GetCreatorStorageQuota,
} from "../controllers/controllers";
import {
  GetBuyerTransactionHistory,
  GetCreatorTransactionHistory,
} from "../controllers/transactionHistoryController";
import {
  PublishPromptVersion,
  ListPromptVersions,
  GetPromptVersionDetail,
} from "../controllers/versioningControllers";
import { Prompt } from "../models/Prompt"; // NEW IMPORT FOR DUPLICATE CHECK

export const promptRouter = express.Router();

// Middleware to prevent duplicate prompt creation with identical content hash
async function checkDuplicateContentHash(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const { contentHash } = req.body;
  if (!contentHash) {
    return next();
  }
  try {
    const existingPrompt = await Prompt.findOne({ contentHash });
    if (existingPrompt) {
      return res.status(409).json({ error: "Prompt with the same content hash already exists." });
    }
    next();
  } catch (error) {
    next(error);
  }
}

promptRouter.route("/").post(checkDuplicateContentHash, CreatePrompt);

promptRouter.route("/").get(GetPrompts);

// External indexer health/visibility — registered before `/:id` so it is not
// shadowed by the generic single-prompt lookup below.
promptRouter.get("/index/status", GetMarketplaceIndexStatus);

promptRouter.get("/buyer/:walletAddress/owned", GetOwnedPrompts);
promptRouter.get("/buyer/:walletAddress/transactions", GetBuyerTransactionHistory);
promptRouter.get("/buyer/:walletAddress/saved", GetSavedPrompts);
promptRouter.get("/creator/:walletAddress/transactions", GetCreatorTransactionHistory);
promptRouter.post("/buyer/save", SavePrompt);
promptRouter.post("/buyer/unsave", UnsavePrompt);
promptRouter.get("/creator/:walletAddress/drafts", GetDraftPrompts);
promptRouter.get("/creator/:walletAddress/quota", GetCreatorStorageQuota);
promptRouter.post("/:id/submit-review", SubmitForReview);
promptRouter.patch("/:id/review-checklist", UpdateReviewChecklist);
promptRouter.post("/:id/tags", AddTags);
promptRouter.delete("/:id/tags", RemoveTags);
promptRouter.post("/:id/publish", PublishPrompt);
promptRouter.post("/:id/archive", ArchivePrompt);
promptRouter.post("/:id/versions", PublishPromptVersion);
promptRouter.get("/:id/versions", ListPromptVersions);
promptRouter.get("/:id/versions/:versionIndex", GetPromptVersionDetail);

// Generic single-prompt lookup -- registered last so it never shadows the
// more specific /buyer, /creator, and /:id/* routes above.
promptRouter.get("/:id", GetPromptDetail);
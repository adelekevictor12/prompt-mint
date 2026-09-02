import express from "express";
import { handleBlobUpload, handleBlobFetch } from "../services/blobStorage";

export const blobRouter = express.Router();

blobRouter.post("/upload", handleBlobUpload);
blobRouter.get("/:id", handleBlobFetch);

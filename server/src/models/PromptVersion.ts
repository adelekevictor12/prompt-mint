import mongoose from "mongoose";

const promptVersionSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    versionIndex: {
      type: Number,
      required: true,
      min: 1,
    },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    encryptedPayloadRef: {
      type: String,
      required: true,
      trim: true,
    },
    changelog: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true },
);

promptVersionSchema.index({ promptId: 1, versionIndex: 1 }, { unique: true });
// Discourage duplicate listings by ensuring the same content hash cannot be stored more than once.
promptVersionSchema.index({ contentHash: 1 }, { unique: true });

const PromptVersion =
  mongoose.models.PromptVersion || mongoose.model("PromptVersion", promptVersionSchema);

export default PromptVersion;

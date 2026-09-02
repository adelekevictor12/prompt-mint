import mongoose from "mongoose";

const promptSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minLength: 3,
      maxLength: 100,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minLength: 10,
    },
    rating: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Marketing",
        "Creative Writing",
        "Programming",
        "Music",
        "Gaming",
        "Other",
      ],
      default: "Other",
    },
    currentVersionIndex: {
      type: Number,
      default: 1,
      min: 1,
    },
    // Anti-plegiarism fields (Issue #133)
    similarityFlag: {
      type: String,
      enum: ["clean", "suspicious", "highly_similar"],
      default: "clean",
      index: true,
    },
    similarityScore: {
      type: Number,
      default: null,
      min: 0,
      max: 1,
    },
    similarTo: {
      // onChainId of the most similar existing prompt, if flagged.
      type: String,
      default: null,
    },
    similarityCheckedAt: {
      type: Date,
      default: null,
    },
    onChainId: {
      type: String,
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    listingStatus: {
      type: String,
      enum: ['draft', 'ready', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    reviewChecklist: {
      contentQuality: { type: Boolean, default: false },
      imageValid: { type: Boolean, default: false },
      pricingSet: { type: Boolean, default: false },
      categoryAssigned: { type: Boolean, default: false },
      termsAccepted: { type: Boolean, default: false },
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: function(v) {
          return v.length <= 10 && v.every(tag => tag.length <= 30);
        },
        message: 'Maximum 10 tags, each up to 30 characters'
      }
    },
    savedPrompts: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    salesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    termsVersion: {
      type: Number,
      default: 1,
      min: 1,
    },
    contentHash: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);
promptSchema.index({ title: 1 });
promptSchema.index({ listingStatus: 1, isActive: 1, createdAt: -1 });
promptSchema.index({ category: 1, listingStatus: 1, isActive: 1 });
promptSchema.index({ owner: 1, listingStatus: 1, createdAt: -1 });
promptSchema.index({ savedPrompts: 1, listingStatus: 1 });
// Unique index on contentHash to prevent duplicate content
promptSchema.index({ contentHash: 1 }, { unique: true, sparse: true });

// Full-text search index used by the indexer-backed marketplace search.
// Covers the off-chain metadata the event indexer keeps in sync so listing
// discovery stays queryable without replaying contract events on every read.
promptSchema.index({ title: "text", content: "text", category: "text", tags: "text" });

// Compound indexes that back the sort options for high-volume pagination.
// Each pairs the sort field with `_id` so keyset (cursor) pagination is
// deterministic even when the sort key has duplicates.
promptSchema.index({ createdAt: -1, _id: -1 });
promptSchema.index({ createdAt: 1, _id: 1 });
promptSchema.index({ price: 1, _id: 1 });
promptSchema.index({ price: -1, _id: -1 });
promptSchema.index({ salesCount: -1, _id: -1 });
promptSchema.index({ rating: -1, _id: -1 });
promptSchema.index({ listingStatus: 1, isActive: 1, price: 1, _id: 1 });
promptSchema.index({ listingStatus: 1, isActive: 1, salesCount: -1, _id: -1 });

// Check if the model exists before creating it
const Prompt = mongoose.models.Prompt || mongoose.model("Prompt", promptSchema);

export default Prompt;
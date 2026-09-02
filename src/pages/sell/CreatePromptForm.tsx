import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import {
  ListingQualityChecklist,
  buildChecklistItems,
} from "@/components/sell/ListingQualityChecklist";
import { CreatorOnboarding } from "@/components/sell/CreatorOnboarding";
import { useBeforeUnloadWarning } from "@/hooks/useBeforeUnloadWarning";
import { featuredPromptTemplates } from "@/data/featuredPrompts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWallet } from "@/hooks/useWallet";
import { unlockPublicKey } from "@/lib/env";
import {
  encryptPromptPlaintext,
  estimateEncryptedPayloadSize,
  wrapPromptKey,
} from "@/lib/crypto/promptCrypto";
import { uploadToBlobStorage } from "@/lib/stellar/blobStorage";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { xlmToStroops } from "@/lib/stellar/format";
import { createPrompt } from "@/lib/stellar/promptHashClient";
import {
  LISTING_LIMITS,
  utf8Length,
  validateListingForm,
  validateListingField,
  validateImageMetadata,
  CONTENT_CLASSIFICATIONS,
  SAFETY_DISCLOSURE_FLAGS,
  type ListingFormInput,
} from "@/lib/validation/listing";
import { useNetworkState } from "@/hooks/useNetworkState";
import { translateError } from "@/lib/i18n-errors";
import { usePrivacyLinter } from "@/hooks/usePrivacyLinter";
import { PrivacyLinterPanel } from "@/components/sell/PrivacyLinterPanel";

const limits = {
  ...LISTING_LIMITS,
  wrappedKey: 256,
};

const categories = Array.from(
  new Set(featuredPromptTemplates.map((prompt) => prompt.category)),
);

interface FormData {
  imageUrl: string;
  title: string;
  category: string;
  previewText: string;
  fullPrompt: string;
  priceXlm: string;
  classification: string;
  safetyFlags: string[];
}

interface CreatePromptFormProps {
  onCreated?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const DRAFT_STORAGE_PREFIX = "prompt-hash:create-draft:";

const createEmptyFormData = (): FormData => ({
  imageUrl: "",
  title: "",
  category: "",
  previewText: "",
  fullPrompt: "",
  priceXlm: "2",
  classification: "",
  safetyFlags: [],
});

const computeIsDirty = (formData: FormData): boolean => {
  const empty = createEmptyFormData();
  return (
    formData.imageUrl !== empty.imageUrl ||
    formData.title !== empty.title ||
    formData.category !== empty.category ||
    formData.previewText !== empty.previewText ||
    formData.fullPrompt !== empty.fullPrompt ||
    formData.priceXlm !== empty.priceXlm ||
    formData.classification !== empty.classification ||
    formData.safetyFlags.length !== empty.safetyFlags.length
  );
};

export function CreatePromptForm({ onCreated, onDirtyChange }: CreatePromptFormProps) {
  const navigate = useNavigate();
  const { address, signTransaction } = useWallet();
  const draftStorageKey = address ? `${DRAFT_STORAGE_PREFIX}${address}` : null;
  const draftLoadRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(false);
  const [formData, setFormData] = useState<FormData>(createEmptyFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [isFirstListing] = useState(true);
  const [imagePreviewState, setImagePreviewState] = useState<"idle" | "loading" | "valid" | "invalid">("idle");
  const [imagePreviewMessage, setImagePreviewMessage] = useState<string | null>(null);

  const isDirty = computeIsDirty(formData);

  useBeforeUnloadWarning(
    isDirty && !isSubmitting,
    "You have unsaved changes. Are you sure you want to leave?",
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const isConfigured = useMemo(
    () =>
      Boolean(
        address &&
          browserStellarConfig.promptHashContractId &&
          unlockPublicKey,
      ),
    [address, signTransaction],
  );

  const checklistItems = useMemo(
    () => buildChecklistItems(formData),
    [formData],
  );

  // #61 – real-time feedback on the *encrypted* payload size (base64 AES-GCM
  // ciphertext), which is what the on-chain MAX_ENCRYPTED_PROMPT_LEN limit
  // actually gates — not the plaintext character count shown while typing.
  const encryptedSizeEstimate = useMemo(
    () => estimateEncryptedPayloadSize(formData.fullPrompt),
    [formData.fullPrompt],
  );
  const encryptedSizeRatio = encryptedSizeEstimate / limits.encryptedPrompt;

  const checklistHasFailures = checklistItems.some((i) => i.status === "fail");

  const linterInput = useMemo(
    () => ({
      title: formData.title,
      preview: formData.previewText,
      description: formData.previewText,
      tags: formData.safetyFlags,
      imageUrl: formData.imageUrl,
    }),
    [formData],
  );
  const { hasBlocking: hasLinterBlockers } = usePrivacyLinter(linterInput);

  const persistDraft = (nextFormData: FormData = formData) => {
    if (!draftStorageKey) {
      return;
    }

    try {
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(
        draftStorageKey,
        JSON.stringify({
          savedAt,
          formData: nextFormData,
        }),
      );
      setLastSavedAt(savedAt);
    } catch {
      setSubmitError("Unable to save your draft locally. Your browser storage may be unavailable.");
    }
  };

  const clearDraft = () => {
    if (draftStorageKey) {
      window.localStorage.removeItem(draftStorageKey);
    }
    skipNextAutosaveRef.current = true;
    setDraftRestored(false);
    setLastSavedAt(null);
  };

  useEffect(() => {
    draftLoadRef.current = null;
    setDraftRestored(false);
    setLastSavedAt(null);

    if (!draftStorageKey) {
      setFormData(createEmptyFormData());
      return;
    }

    const rawDraft = window.localStorage.getItem(draftStorageKey);
    if (!rawDraft) {
      skipNextAutosaveRef.current = true;
      setFormData(createEmptyFormData());
      draftLoadRef.current = draftStorageKey;
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as {
        formData?: Partial<FormData>;
        savedAt?: string;
      };

      if (parsed.formData) {
        setFormData((current) => ({
          ...current,
          ...parsed.formData,
        }));
        setDraftRestored(true);
        setLastSavedAt(parsed.savedAt ?? null);
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    } finally {
      draftLoadRef.current = draftStorageKey;
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || draftLoadRef.current !== draftStorageKey || isSubmitting) {
      return;
    }

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      persistDraft(formData);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [draftStorageKey, formData, isSubmitting]);

  useEffect(() => {
    return () => {
      if (!draftStorageKey || isSubmitting) {
        return;
      }

      persistDraft(formData);
    };
  }, [draftStorageKey, formData, isSubmitting]);

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });

    if (name === "imageUrl") {
      setImagePreviewState("idle");
      setImagePreviewMessage(null);
      if (!value.trim()) {
        setImagePreviewState("invalid");
        setImagePreviewMessage("Add an image URL to preview your listing cover.");
      }
    }
  };

  const handleCategoryChange = (value: string) => {
    setFormData((previous) => ({ ...previous, category: value }));
    setTouched((previous) => ({ ...previous, category: true }));
    setErrors((previous) => {
      const next = { ...previous };
      delete next.category;
      return next;
    });
  };

  // #269 – order used to auto-focus the first invalid field on a failed submit
  const FIELD_ORDER: (keyof ListingFormInput)[] = [
    "imageUrl",
    "title",
    "category",
    "previewText",
    "priceXlm",
    "classification",
    "fullPrompt",
  ];

  const validateForm = () => {
    const nextErrors = validateListingForm(formData);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Auto-focus the first invalid field so the user lands on the problem.
      const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
      if (firstInvalid) {
        requestAnimationFrame(() =>
          document.getElementById(firstInvalid)?.focus(),
        );
      }
      return false;
    }
    return true;
  };

  // #269 – validate a single field on blur so feedback is inline and real-time.
  const handleBlur = (name: keyof ListingFormInput) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const message = validateListingField(name, formData);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) {
        next[name] = message;
      } else {
        delete next[name];
      }
      return next;
    });
  };

  useEffect(() => {
    if (!formData.imageUrl.trim()) {
      return;
    }

    const isLikelyUrl = /^https?:\/\/.+/i.test(formData.imageUrl.trim());
    if (!isLikelyUrl) {
      setImagePreviewState("invalid");
      setImagePreviewMessage("Use a full http:// or https:// URL to preview the image.");
      return;
    }

    let active = true;
    setImagePreviewState("loading");
    setImagePreviewMessage("Checking image URL...");

    validateImageMetadata(formData.imageUrl.trim())
      .then((error) => {
        if (!active) return;
        if (error) {
          setImagePreviewState("invalid");
          setImagePreviewMessage(error);
          return;
        }
        setImagePreviewState("valid");
        setImagePreviewMessage("Preview available.");
      })
      .catch(() => {
        if (!active) return;
        setImagePreviewState("invalid");
        setImagePreviewMessage("Unable to validate the image URL right now.");
      });

    return () => {
      active = false;
    };
  }, [formData.imageUrl]);
  // #269 – a field is "success" once touched and passing validation.
  const isFieldValid = (name: keyof ListingFormInput) =>
    Boolean(touched[name]) && !validateListingField(name, formData);

  const fieldClass = (name: keyof ListingFormInput) =>
    errors[name]
      ? "border-red-500"
      : isFieldValid(name)
        ? "border-emerald-500 focus-visible:ring-emerald-500/30"
        : "";

  // #269 – submit stays disabled until every required field is valid.
  const isFormValid = useMemo(
    () => Object.keys(validateListingForm(formData)).length === 0,
    [formData],
  );

  const networkState = useNetworkState();
  const submittingGuardRef = useRef(false);

  const handleSubmit = async () => {
    if (submittingGuardRef.current || isSubmitting) return;

    setSubmitError(null);
    setSuccessMessage(null);

    if (!networkState.canTrustConfirmation) {
      setSubmitError(
        "Network connection lost or RPC unavailable. Your listing draft is saved locally, but on-chain submission is disabled until restored."
      );
      return;
    }

    // Show checklist on first click so the creator can review quality
    if (!showChecklist) {
      setShowChecklist(true);
    }

    if (!validateForm()) {
      return;
    }

    persistDraft(formData);

    setIsSubmitting(true);
    const imageError = await validateImageMetadata(formData.imageUrl);
    if (imageError) {
      setErrors((prev) => ({ ...prev, imageUrl: imageError }));
      setIsSubmitting(false);
      return;
    }

    if (!address || !signTransaction) {
      setSubmitError("Connect a Stellar wallet before creating a prompt.");
      setIsSubmitting(false);
      return;
    }

    if (!browserStellarConfig.promptHashContractId) {
      setSubmitError("PUBLIC_PROMPT_HASH_CONTRACT_ID is not configured.");
      setIsSubmitting(false);
      return;
    }

    if (!unlockPublicKey) {
      setSubmitError("PUBLIC_UNLOCK_PUBLIC_KEY is not configured.");
      setIsSubmitting(false);
      return;
    }

    submittingGuardRef.current = true;
    setIsSubmitting(true);
    try {
      const encrypted = await encryptPromptPlaintext(formData.fullPrompt);
      const wrappedKey = await wrapPromptKey(encrypted.keyBytes, unlockPublicKey);

      let encryptedPrompt = encrypted.encryptedPrompt;
      if (encryptedPrompt.length > limits.encryptedPrompt) {
        try {
          encryptedPrompt = await uploadToBlobStorage(encryptedPrompt);
        } catch (error) {
          setSubmitError(
            `Failed to store encrypted prompt off-chain: ${error instanceof Error ? error.message : "Unknown error"}`
          );
          setIsSubmitting(false);
          return;
        }
      }

      if (wrappedKey.length > limits.wrappedKey) {
        throw new Error("Wrapped key exceeds the contract storage limit.");
      }

      const { promptId } = await createPrompt(
        browserStellarConfig,
        { signTransaction },
        address,
        {
          imageUrl: formData.imageUrl.trim(),
          title: formData.title.trim(),
          category: formData.category,
          previewText: formData.previewText.trim(),
          encryptedPrompt,
          encryptionIv: encrypted.encryptionIv,
          wrappedKey,
          contentHash: encrypted.contentHash,
          priceStroops: xlmToStroops(formData.priceXlm),
        },
      );

      setSuccessMessage(`Prompt #${promptId.toString()} created successfully.`);
      clearDraft();
      setFormData(createEmptyFormData());
      if (onCreated) {
        onCreated();
      } else {
        navigate("/browse");
      }
    } catch (error) {
      setSubmitError(
        translateError(error instanceof Error ? error.message : "Failed to create prompt.")
      );
    } finally {
      setIsSubmitting(false);
      submittingGuardRef.current = false;
    }
  };

  return (
    <div className="space-y-6">
      {showOnboarding && (
        <CreatorOnboarding
          isFirstListing={isFirstListing}
          onDismiss={() => setShowOnboarding(false)}
        />
      )}

      {!isConfigured ? (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Connect your wallet and configure `PUBLIC_PROMPT_HASH_CONTRACT_ID` plus
          `PUBLIC_UNLOCK_PUBLIC_KEY` before listing prompts.
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="imageUrl" className="text-sm font-medium">
            Image URL
          </label>
          <Input
            id="imageUrl"
            name="imageUrl"
            value={formData.imageUrl}
            onChange={handleChange}
            onBlur={() => handleBlur("imageUrl")}
            type="url"
            autoComplete="url"
            placeholder="https://example.com/prompt-cover.png"
            className={fieldClass("imageUrl")}
            aria-invalid={!!errors.imageUrl}
            aria-describedby={errors.imageUrl ? "imageUrl-error" : undefined}
          />
          {errors.imageUrl ? (
            <p id="imageUrl-error" className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.imageUrl}
            </p>
          ) : isFieldValid("imageUrl") ? (
            <p className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Looks good
            </p>
          ) : null}
          {formData.imageUrl.trim() ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Image preview</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${imagePreviewState === "valid" ? "bg-emerald-500/15 text-emerald-300" : imagePreviewState === "loading" ? "bg-cyan-500/15 text-cyan-300" : "bg-red-500/15 text-red-300"}`}>
                  {imagePreviewState === "valid" ? "Ready" : imagePreviewState === "loading" ? "Checking" : "Needs attention"}
                </span>
              </div>
              {imagePreviewState === "loading" ? (
                <p className="text-sm text-slate-300">{imagePreviewMessage}</p>
              ) : (
                <>
                  <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/60">
                    <img
                      src={formData.imageUrl.trim()}
                      alt="Listing cover preview"
                      className="h-40 w-full object-cover"
                      onError={() => {
                        setImagePreviewState("invalid");
                        setImagePreviewMessage("The image could not be loaded. Try another URL.");
                      }}
                    />
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{imagePreviewMessage}</p>
                </>
              )}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="title" className="text-sm font-medium">
            Title
          </label>
          <Input
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            onBlur={() => handleBlur("title")}
            autoComplete="off"
            placeholder="Board-ready launch plan"
            className={fieldClass("title")}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "title-error" : undefined}
          />
          <p className="text-xs text-slate-400">
            {utf8Length(formData.title)}/{limits.title}
          </p>
          {errors.title ? (
            <p id="title-error" className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.title}
            </p>
          ) : isFieldValid("title") ? (
            <p className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Looks good
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_220px]">
        <div className="space-y-2">
          <label htmlFor="previewText" className="text-sm font-medium">
            Preview text
          </label>
          <Textarea
            id="previewText"
            name="previewText"
            value={formData.previewText}
            onChange={handleChange}
            onBlur={() => handleBlur("previewText")}
            placeholder="Brief description of the prompt. This will be publicly visible."
            className={`min-h-[120px] resize-none ${fieldClass("previewText")}`}
            aria-invalid={!!errors.previewText}
            aria-describedby={errors.previewText ? "previewText-error" : undefined}
          />
          <p className="text-xs text-slate-400">
            {utf8Length(formData.previewText)}/{limits.preview}
          </p>
          {errors.previewText ? (
            <p id="previewText-error" className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.previewText}
            </p>
          ) : isFieldValid("previewText") ? (
            <p className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Looks good
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label htmlFor="category" className="text-sm font-medium">
            Category
          </label>
          <Select value={formData.category} onValueChange={handleCategoryChange}>
            <SelectTrigger
              id="category"
              className={fieldClass("category")}
            >
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.category ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.category}
            </p>
          ) : null}

          <label htmlFor="priceXlm" className="pt-3 text-sm font-medium">
            Price in XLM
          </label>
          <Input
            id="priceXlm"
            name="priceXlm"
            value={formData.priceXlm}
            onChange={handleChange}
            onBlur={() => handleBlur("priceXlm")}
            type="number"
            min="1"
            step="1"
            className={fieldClass("priceXlm")}
            aria-invalid={!!errors.priceXlm}
            aria-describedby={errors.priceXlm ? "priceXlm-error" : undefined}
          />
          {errors.priceXlm ? (
            <p id="priceXlm-error" className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.priceXlm}
            </p>
          ) : isFieldValid("priceXlm") ? (
            <p className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Looks good
            </p>
          ) : null}
        </div>
      </div>

      {/* #131 – Content Classification */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <h3 className="text-sm font-bold text-emerald-400">Content Classification & Buyer Safety</h3>
        <p className="text-xs text-slate-400">Classify your prompt to help buyers make informed choices.</p>

        <div className="space-y-2">
          <label htmlFor="classification" className="text-sm font-medium">
            Content Classification
          </label>
          <Select
            value={formData.classification}
            onValueChange={(value) => {
              setFormData((prev) => ({ ...prev, classification: value }));
              setTouched((prev) => ({ ...prev, classification: true }));
              setErrors((prev) => {
                const next = { ...prev };
                delete next.classification;
                return next;
              });
            }}
          >
            <SelectTrigger
              id="classification"
              className={fieldClass("classification")}
            >
              <SelectValue placeholder="Select classification" />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_CLASSIFICATIONS.map((cls) => (
                <SelectItem key={cls.value} value={cls.value}>
                  <div className="flex flex-col">
                    <span>{cls.label}</span>
                    <span className="text-xs text-slate-400">{cls.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.classification ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.classification}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Safety Disclosure Flags</label>
          <p className="text-xs text-slate-400">Select any that apply to your content.</p>
          <div className="grid grid-cols-2 gap-2">
            {SAFETY_DISCLOSURE_FLAGS.map((flag) => {
              const isSelected = formData.safetyFlags.includes(flag.value);
              return (
                <button
                  key={flag.value}
                  type="button"
                  onClick={() => {
                    if (flag.value === "none") {
                      setFormData((prev) => ({ ...prev, safetyFlags: ["none"] }));
                    } else {
                      setFormData((prev) => {
                        const current = prev.safetyFlags.filter((f) => f !== "none");
                        return {
                          ...prev,
                          safetyFlags: isSelected
                            ? current.filter((f) => f !== flag.value)
                            : [...current, flag.value],
                        };
                      });
                    }
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                    isSelected
                      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                      : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isSelected ? "bg-emerald-400" : "bg-slate-500"
                    }`}
                  />
                  {flag.label}
                </button>
              );
            })}
          </div>
          {errors.safetyFlags ? (
            <p className="flex items-center gap-1 text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.safetyFlags}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="fullPrompt" className="text-sm font-medium">
          Full prompt
        </label>
        <Textarea
          id="fullPrompt"
          name="fullPrompt"
          value={formData.fullPrompt}
          onChange={handleChange}
          onBlur={() => handleBlur("fullPrompt")}
          autoComplete="off"
          rows={12}
          placeholder="This plaintext is encrypted in the browser, then only encrypted fields are sent on-chain."
          className={fieldClass("fullPrompt")}
          aria-invalid={!!errors.fullPrompt}
          aria-describedby={
            errors.fullPrompt ? "fullPrompt-error" : "fullPrompt-encrypted-size"
          }
        />
        <p
          id="fullPrompt-encrypted-size"
          className={`text-xs ${
            encryptedSizeRatio > 1
              ? "text-red-400"
              : encryptedSizeRatio > 0.9
                ? "text-amber-400"
                : "text-slate-400"
          }`}
        >
          Encrypted size: {encryptedSizeEstimate.toLocaleString()} /{" "}
          {limits.encryptedPrompt.toLocaleString()} bytes
          {encryptedSizeRatio > 1
            ? " — too large once encrypted, shorten the prompt"
            : ""}
        </p>
        {errors.fullPrompt ? (
          <p id="fullPrompt-error" className="flex items-center gap-1 text-sm text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {errors.fullPrompt}
          </p>
        ) : isFieldValid("fullPrompt") ? (
          <p className="flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Looks good
          </p>
        ) : null}
      </div>

      <PrivacyLinterPanel input={linterInput} />

      {showChecklist ? (
        <ListingQualityChecklist items={checklistItems} />
      ) : null}

      {(draftRestored || lastSavedAt) && !isSubmitting ? (
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {draftRestored ? "Recovered local draft." : "Draft saved locally."}
              </p>
              <p className="text-xs text-cyan-100/80">
                Stored only on this device and cleared after publish or discard.
                {lastSavedAt ? ` Last saved ${new Date(lastSavedAt).toLocaleString()}.` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9 border-cyan-300/30 bg-cyan-500/10 text-cyan-50 hover:bg-cyan-500/20"
              onClick={() => {
                clearDraft();
                setFormData(createEmptyFormData());
                setErrors({});
                setShowChecklist(false);
              }}
            >
              Discard draft
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
        disabled={
          isSubmitting ||
          !networkState.canTrustConfirmation ||
          !isFormValid ||
          (showChecklist && checklistHasFailures) ||
          hasLinterBlockers
        }
        onClick={handleSubmit}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Encrypting and submitting...
          </>
        ) : !networkState.canTrustConfirmation ? (
          "Submissions Disabled (Network Offline)"
        ) : (
          "Create prompt listing"
        )}
      </Button>

      {submitError ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {submitError}
        </div>
      ) : null}

      {successMessage ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {successMessage}
        </div>
      ) : null}
    </div>
  );
}

import { Buffer } from "buffer";

export type KmsProviderMode = "plaintext" | "envelope" | "kms";

export interface KmsConfig {
  mode: KmsProviderMode;
  unlockPrivateKey?: string;
  encryptedPrivateKey?: string;
  masterSecret?: string;
  kmsKeyArn?: string;
}

/**
  * Encrypts a private key string with a master secret using AES-256-GCM for envelope encryption at rest.
  */
export async function encryptPrivateKeyForStorage(
  privateKeyBase64: string,
  masterSecret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(masterSecret.padEnd(32, "0").slice(0, 32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const importedMasterKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    importedMasterKey,
    encoder.encode(privateKeyBase64),
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return Buffer.from(combined).toString("base64");
}

/**
  * Decrypts an envelope-encrypted private key ciphertext using the master secret.
  */
export async function decryptEnvelopePrivateKey(
  encryptedBase64: string,
  masterSecret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const secretBytes = encoder.encode(masterSecret.padEnd(32, "0").slice(0, 32));
  const combined = Uint8Array.from(Buffer.from(encryptedBase64, "base64"));

  if (combined.length < 28) {
    throw new Error("Invalid envelope encrypted private key ciphertext.");
  }

  const iv = combined.subarray(0, 12);
  const ciphertext = combined.subarray(12);

  const importedMasterKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    importedMasterKey,
    ciphertext,
  );

  return decoder.decode(decrypted);
}

/**
  * Resolves and loads the unlock private key from environment variables or KMS configuration.
  * Prioritizes envelope encryption / KMS over raw plaintext environment variables.
  */
export async function loadUnlockPrivateKey(overrideConfig?: KmsConfig): Promise<string> {
  const mode: KmsProviderMode =
    overrideConfig?.mode ||
    (process.env.ENCRYPTION_KMS_PROVIDER as KmsProviderMode) ||
    (process.env.ENCRYPTED_UNLOCK_PRIVATE_KEY ? "envelope" : "plaintext");

  if (mode === "envelope" || overrideConfig?.encryptedPrivateKey) {
    const encrypted = overrideConfig?.encryptedPrivateKey || process.env.ENCRYPTED_UNLOCK_PRIVATE_KEY;
    const secret = overrideConfig?.masterSecret || process.env.KMS_MASTER_SECRET || process.env.CHALLENGE_TOKEN_SECRET;

    if (!encrypted) {
      throw new Error("[KMS Error]: ENCRYPTED_UNLOCK_PRIVATE_KEY is not configured.");
    }
    if (!secret) {
      throw new Error("[KMS Error]: KMS_MASTER_SECRET or secret key is required for envelope decryption.");
    }

    return await decryptEnvelopePrivateKey(encrypted, secret);
  }

  if (mode === "kms") {
    const kmsArn = overrideConfig?.kmsKeyArn || process.env.UNLOCK_PRIVATE_KEY_KMS_ARN || process.env.KMS_KEY_ARN;
    const encrypted = overrideConfig?.encryptedPrivateKey || process.env.ENCRYPTED_UNLOCK_PRIVATE_KEY;
    const secret = overrideConfig?.masterSecret || process.env.KMS_MASTER_SECRET;

    if (!kmsArn && !encrypted) {
      throw new Error("[KMS Error]: KMS ARN or encrypted key payload required for KMS mode.");
    }

    if (encrypted && secret) {
      return await decryptEnvelopePrivateKey(encrypted, secret);
    }
  }

  // Fallback to plaintext environment variable (for local dev)
  const plaintext = overrideConfig?.unlockPrivateKey || process.env.UNLOCK_PRIVATE_KEY;
  if (!plaintext) {
    throw new Error("[KMS Error]: No unlock private key configured in environment or KMS.");
  }

  return plaintext;
}

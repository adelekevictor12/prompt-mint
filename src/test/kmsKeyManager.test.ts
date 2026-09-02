import { describe, it, expect } from "vitest";
import {
  encryptPrivateKeyForStorage,
  decryptEnvelopePrivateKey,
  loadUnlockPrivateKey,
} from "../lib/crypto/kmsKeyManager";

describe("KMS / Envelope Encryption for Unlock Private Key (#447)", () => {
  const samplePrivateKey = "dGVzdC1wcml2YXRlLWtleS1iYXNlNjQtc2FtcGxlLTEyMzQ1Njc4OTA=";
  const masterSecret = "super-secret-kms-master-key-32chars!";

  it("encrypts and decrypts private key via envelope encryption", async () => {
    const encrypted = await encryptPrivateKeyForStorage(samplePrivateKey, masterSecret);
    expect(encrypted).not.toBe(samplePrivateKey);

    const decrypted = await decryptEnvelopePrivateKey(encrypted, masterSecret);
    expect(decrypted).toBe(samplePrivateKey);
  });

  it("loads unlock key from envelope configuration in loadUnlockPrivateKey", async () => {
    const encrypted = await encryptPrivateKeyForStorage(samplePrivateKey, masterSecret);

    const loadedKey = await loadUnlockPrivateKey({
      mode: "envelope",
      encryptedPrivateKey: encrypted,
      masterSecret: masterSecret,
    });

    expect(loadedKey).toBe(samplePrivateKey);
  });

  it("falls back to plaintext mode when no encrypted key is provided", async () => {
    const loadedKey = await loadUnlockPrivateKey({
      mode: "plaintext",
      unlockPrivateKey: samplePrivateKey,
    });

    expect(loadedKey).toBe(samplePrivateKey);
  });

  it("throws detailed error when decryption key is missing or invalid", async () => {
    await expect(
      loadUnlockPrivateKey({
        mode: "envelope",
        encryptedPrivateKey: "invalid-ciphertext",
        masterSecret: masterSecret,
      }),
    ).rejects.toThrow();
  });
});

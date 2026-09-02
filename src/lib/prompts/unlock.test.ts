import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_MESSAGES } from "@/lib/api/errorCodes";

const hashPromptPlaintextMock = vi.fn();

vi.mock("@/lib/crypto/promptCrypto", () => ({
  hashPromptPlaintext: (...args: unknown[]) => hashPromptPlaintextMock(...args),
}));

import { unlockPromptContent } from "./unlock";

describe("unlockPromptContent client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hashPromptPlaintextMock.mockResolvedValue("abc123");
  });

  it("requests a challenge, signs it, and returns verified plaintext", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "token-1",
            challenge: "prompt-hash unlock:challenge",
            expiresAt: Date.now() + 60_000,
            nonce: "nonce-1",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            promptId: "7",
            title: "Test prompt",
            contentHash: "abc123",
            plaintext: "Decrypted prompt body",
            integrity: { status: "verified", computedHash: "abc123", storedHash: "abc123" },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const signMessage = vi.fn().mockResolvedValue({ signedMessage: "signed-by-wallet" });
    const result = await unlockPromptContent(
      "GA6HITF5ZBTSGXVGSLM56FEYDPS7T4KRFACQIR34RZRR4JTI5LJSX2WE",
      7n,
      signMessage,
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/challenge",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/prompts/unlock",
      expect.objectContaining({ method: "POST" }),
    );
    expect(signMessage).toHaveBeenCalledWith("prompt-hash unlock:challenge");
    expect(result.plaintext).toBe("Decrypted prompt body");
    expect(result.decryptedContent).toBe("Decrypted prompt body");
    // Integrity metadata must be present on the result
    expect(result.integrity).toBeDefined();
    expect(result.integrity.status).toBe("verified");
    expect(result.integrity.computedHash).toBe("abc123");
    expect(result.integrity.storedHash).toBe("abc123");
  });

  it("propagates integrity metadata with status 'unavailable' for legacy listings", async () => {
    hashPromptPlaintextMock.mockResolvedValue("abc123");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              token: "token-1",
              challenge: "prompt-hash unlock:challenge",
              expiresAt: Date.now() + 60_000,
              nonce: "nonce-1",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              promptId: "7",
              title: "Legacy prompt",
              contentHash: "",
              plaintext: "Legacy prompt body",
              integrity: { status: "unavailable", computedHash: "abc123", storedHash: null },
            }),
            { status: 200 },
          ),
        ),
    );

    const result = await unlockPromptContent(
      "GA6HITF5ZBTSGXVGSLM56FEYDPS7T4KRFACQIR34RZRR4JTI5LJSX2WE",
      "7",
      vi.fn().mockResolvedValue({ signedMessage: "signed-by-wallet" }),
    );

    expect(result.plaintext).toBe("Legacy prompt body");
    expect(result.integrity.status).toBe("unavailable");
    expect(result.integrity.storedHash).toBeNull();
  });

  it("throws an integrity error when the server reports a hash mismatch (stale-version scenario)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              token: "token-1",
              challenge: "prompt-hash unlock:challenge",
              expiresAt: Date.now() + 60_000,
              nonce: "nonce-1",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              promptId: "7",
              title: "Updated prompt",
              // Server returns no plaintext and a failed integrity status
              integrity: {
                status: "failed",
                computedHash: "f".repeat(64),
                storedHash: "a".repeat(64),
              },
            }),
            { status: 200 },
          ),
        ),
    );

    await expect(
      unlockPromptContent(
        "GA6HITF5ZBTSGXVGSLM56FEYDPS7T4KRFACQIR34RZRR4JTI5LJSX2WE",
        "7",
        vi.fn().mockResolvedValue({ signedMessage: "signed-by-wallet" }),
      ),
    ).rejects.toThrow(ERROR_MESSAGES.INTEGRITY_FAILURE);
  });

  it("maps integrity failures to safe user-facing errors", async () => {
    hashPromptPlaintextMock.mockResolvedValue("different-hash");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              token: "token-1",
              challenge: "prompt-hash unlock:challenge",
              expiresAt: Date.now() + 60_000,
              nonce: "nonce-1",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              promptId: "7",
              title: "Test prompt",
              contentHash: "abc123",
              plaintext: "Decrypted prompt body",
            }),
            { status: 200 },
          ),
        ),
    );

    await expect(
      unlockPromptContent(
        "GA6HITF5ZBTSGXVGSLM56FEYDPS7T4KRFACQIR34RZRR4JTI5LJSX2WE",
        "7",
        vi.fn().mockResolvedValue({ signedMessage: "signed-by-wallet" }),
      ),
    ).rejects.toThrow(ERROR_MESSAGES.INTEGRITY_FAILURE);
  });

  it("maps API error codes without exposing sensitive backend details", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              token: "token-1",
              challenge: "prompt-hash unlock:challenge",
              expiresAt: Date.now() + 60_000,
              nonce: "nonce-1",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: "Prompt integrity check failed.",
              code: "INTEGRITY_FAILURE",
            }),
            { status: 500 },
          ),
        ),
    );

    await expect(
      unlockPromptContent(
        "GA6HITF5ZBTSGXVGSLM56FEYDPS7T4KRFACQIR34RZRR4JTI5LJSX2WE",
        "7",
        vi.fn().mockResolvedValue({ signedMessage: "signed-by-wallet" }),
      ),
    ).rejects.toThrow(ERROR_MESSAGES.INTEGRITY_FAILURE);
  });
});

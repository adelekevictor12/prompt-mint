import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCreatorVerification } from "@/hooks/useCreatorVerification";
import { fetchStellarToml } from "@/lib/identity/stellarToml";

const CREATOR = "GCREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATORX";

const TOML = `SIGNING_KEY = "GORGSIGNINGKEYORGSIGNINGKEYORGSIGNINGKEYORGSIGNINGKEYORGSIGN"
ACCOUNTS = ["${CREATOR}"]
`;

describe("useCreatorVerification", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("verifies a creator domain via SEP-1 stellar.toml", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        expect(String(input)).toContain("/.well-known/stellar.toml");
        return {
          ok: true,
          status: 200,
          text: async () => TOML,
        } as Response;
      }),
    );

    const { result } = renderHook(() => useCreatorVerification(CREATOR));

    expect(result.current.verification).toBeNull();

    await act(async () => {
      await result.current.verifyDomain("creator.example");
    });

    await waitFor(() => {
      expect(result.current.verification?.status).toBe("verified");
    });
    expect(result.current.verification?.method).toBe("sep1-toml");
  });

  it("reports unverified when the account is missing from the toml", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          `ACCOUNTS = ["GOTHEROTHEROTHEROTHEROTHEROTHEROTHEROTHEROTHER"]`,
      })) as typeof fetch,
    );

    const { result } = renderHook(() =>
      useCreatorVerification("GABSENTABSENTABSENTABSENTABSENTABSENTABSENT"),
    );

    await act(async () => {
      await result.current.verifyDomain("creator.example");
    });

    await waitFor(() => {
      expect(result.current.verification?.status).toBe("unverified");
    });
  });

  it("rejects non-HTTPS stellar.toml URLs", async () => {
    await expect(fetchStellarToml("http://insecure.example/.well-known/stellar.toml")).rejects.toThrow(
      /HTTPS/,
    );
  });
});

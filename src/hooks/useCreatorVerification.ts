import { useCallback, useEffect, useState } from "react";
import {
  evaluateCreatorVerification,
  fetchStellarToml,
  type CreatorVerification,
} from "@/lib/identity";
import {
  clearVerification,
  getStoredVerification,
  storeVerification,
} from "@/lib/identity/store";

function tomlUrlForDomain(domain: string): string {
  const cleaned = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${cleaned}/.well-known/stellar.toml`;
}

export interface UseCreatorVerificationOptions {
  /** Optional pre-known stellar.toml URL for this creator (e.g. from the API). */
  stellarTomlUrl?: string;
  /** Whether the reputation service already confirmed an external link. */
  externalVerified?: boolean;
}

export interface UseCreatorVerificationResult {
  verification: CreatorVerification | null;
  isLoading: boolean;
  error: string | null;
  /** Run SEP-1/SEP-12 verification against a creator-controlled domain. */
  verifyDomain: (domain: string) => Promise<CreatorVerification>;
  reset: () => void;
}

export function useCreatorVerification(
  address: string | undefined,
  options: UseCreatorVerificationOptions = {},
): UseCreatorVerificationResult {
  const { stellarTomlUrl, externalVerified } = options;
  const [verification, setVerification] = useState<CreatorVerification | null>(
    address ? getStoredVerification(address) : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setVerification(null);
      return;
    }
    const stored = getStoredVerification(address);
    if (stored) {
      setVerification(stored);
      return;
    }
    if (externalVerified) {
      setVerification({
        status: "verified",
        method: "external-link",
        message: "Verified via an externally confirmed creator link.",
      });
    }
  }, [address, externalVerified]);

  const verifyDomain = useCallback(
    async (domain: string): Promise<CreatorVerification> => {
      if (!address) {
        const missing: CreatorVerification = {
          status: "error",
          message: "Connect a wallet to verify your creator identity.",
        };
        setError(missing.message ?? "Unable to verify.");
        setVerification(missing);
        return missing;
      }

      setIsLoading(true);
      setError(null);
      try {
        const url = stellarTomlUrl ?? tomlUrlForDomain(domain);
        const toml = await fetchStellarToml(url);
        const result = evaluateCreatorVerification({
          account: address,
          toml,
          stellarTomlUrl: url,
          externalVerified,
        });
        if (result.status === "verified") {
          storeVerification(address, result);
        }
        setVerification(result);
        if (result.status === "error" || result.status === "unverified") {
          setError(result.message ?? "Verification failed.");
        }
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not verify creator identity.";
        const failed: CreatorVerification = { status: "error", message };
        setError(message);
        setVerification(failed);
        return failed;
      } finally {
        setIsLoading(false);
      }
    },
    [address, stellarTomlUrl, externalVerified],
  );

  const reset = useCallback(() => {
    if (address) clearVerification(address);
    setVerification(null);
    setError(null);
  }, [address]);

  return { verification, isLoading, error, verifyDomain, reset };
}

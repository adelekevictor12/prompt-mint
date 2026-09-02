import { Keypair } from "@stellar/stellar-base";
import type {
  CreatorVerification,
  Sep12Attestation,
  StellarToml,
} from "./types";
import { findCreatorInToml } from "./stellarToml";

/** Deterministic, signable representation of a SEP-12 attestation. */
export function buildAttestationPayload(attestation: Sep12Attestation): string {
  return [
    `schema=${attestation.schema}`,
    `domain=${attestation.domain}`,
    `account=${attestation.account}`,
    `name=${attestation.name}`,
    `type=${attestation.type}`,
    `status=${attestation.status}`,
    `issuedAt=${attestation.issuedAt}`,
  ].join("\n");
}

export function isValidEd25519PublicKey(key?: string): boolean {
  if (!key) return false;
  try {
    Keypair.fromPublicKey(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a SEP-12-style attestation against the `SIGNING_KEY` published in the
 * creator's `stellar.toml` (SEP-1). The signature is a base64 ed25519
 * signature over {@link buildAttestationPayload}.
 */
export function verifySep12Attestation(params: {
  attestation: Sep12Attestation;
  signingKey: string;
}): boolean {
  const { attestation, signingKey } = params;
  if (!isValidEd25519PublicKey(signingKey)) return false;
  if (attestation.status !== "VERIFIED") return false;
  let signature: Buffer;
  try {
    signature = Buffer.from(attestation.signature, "base64");
  } catch {
    return false;
  }
  try {
    const keypair = Keypair.fromPublicKey(signingKey);
    return keypair.verify(Buffer.from(buildAttestationPayload(attestation), "utf8"), signature);
  } catch {
    return false;
  }
}

/** SEP-1 account ownership check: is the creator account declared in the TOML? */
export function verifySep1Identity(params: {
  account: string;
  toml: StellarToml;
}): boolean {
  return findCreatorInToml(params.toml, params.account).found;
}

export interface EvaluateVerificationParams {
  account: string;
  toml: StellarToml;
  attestation?: Sep12Attestation;
  stellarTomlUrl?: string;
  externalVerified?: boolean;
}

/**
 * Combine the SEP-1 account check and optional SEP-12 attestation into a single
 * creator verification result. Falls back to an `external-link` signal when the
 * marketplace reputation service has already confirmed a link.
 */
export function evaluateCreatorVerification(
  params: EvaluateVerificationParams,
): CreatorVerification {
  const { account, toml, attestation, stellarTomlUrl, externalVerified } = params;
  const match = findCreatorInToml(toml, account);

  if (!match.found) {
    if (externalVerified) {
      return {
        status: "verified",
        method: "external-link",
        stellarTomlUrl,
        message: "Verified via an externally confirmed creator link.",
      };
    }
    return {
      status: "unverified",
      stellarTomlUrl,
      message: "This Stellar account was not found in the domain's stellar.toml.",
    };
  }

  const domain = attestation?.domain ?? extractDomain(stellarTomlUrl) ?? "stellar.toml";

  if (attestation && toml.signingKey) {
    const valid = verifySep12Attestation({
      attestation,
      signingKey: toml.signingKey,
    });
    if (!valid) {
      return {
        status: "error",
        method: "sep12-attestation",
        domain,
        stellarTomlUrl,
        message: "Attestation signature did not match the domain signing key.",
      };
    }
    return {
      status: "verified",
      method: "sep12-attestation",
      domain,
      name: attestation.name,
      identityType: attestation.type,
      issuedAt: attestation.issuedAt,
      attestationUrl: attestation.attestationUrl,
      stellarTomlUrl,
      message: "Identity verified via SEP-1 discovery and a signed SEP-12 attestation.",
    };
  }

  return {
    status: "verified",
    method: "sep1-toml",
    domain,
    name: match.name,
    stellarTomlUrl,
    message: "Creator account confirmed in the domain's stellar.toml (SEP-1).",
  };
}

function extractDomain(stellarTomlUrl?: string): string | undefined {
  if (!stellarTomlUrl) return undefined;
  try {
    return new URL(stellarTomlUrl).hostname;
  } catch {
    return undefined;
  }
}

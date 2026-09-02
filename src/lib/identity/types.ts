/**
 * SEP-compatible creator identity & verification types.
 *
 * The design follows the Stellar Ecosystem Proposal patterns used across the
 * network:
 *  - SEP-1 (Stellar Info File): a creator proves control of a domain by
 *    publishing a `stellar.toml` that lists their Stellar account and a
 *    `SIGNING_KEY` used to attest identity.
 *  - SEP-12 (KYC / identity): an attestation object (mirroring a SEP-12
 *    customer record) signed by that `SIGNING_KEY` confirms the creator's
 *    verified legal/display identity.
 */

export type VerificationStatus =
  | "verified"
  | "unverified"
  | "pending"
  | "error";

export type VerificationMethod =
  | "sep1-toml"
  | "sep12-attestation"
  | "external-link";

export interface CreatorVerification {
  status: VerificationStatus;
  method?: VerificationMethod;
  domain?: string;
  name?: string;
  identityType?: "individual" | "organization";
  issuedAt?: string;
  stellarTomlUrl?: string;
  attestationUrl?: string;
  message?: string;
}

/** Parsed subset of a SEP-1 `stellar.toml` we rely on. */
export interface StellarToml {
  signingKey?: string;
  accounts: string[];
  /** Custom array-of-tables advertising verified creators. */
  verifiedCreators: Array<{
    account?: string;
    name?: string;
    handle?: string;
  }>;
  /** Arbitrary extra keys, preserved for debugging/display. */
  [key: string]: unknown;
}

/** SEP-12-style signed identity attestation for a creator. */
export interface Sep12Attestation {
  schema: "sep12-creator-v1";
  domain: string;
  account: string;
  name: string;
  type: "individual" | "organization";
  status: "VERIFIED" | "PENDING" | "REJECTED";
  issuedAt: string;
  attestationUrl?: string;
  signature: string;
}

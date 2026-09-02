import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-base";
import {
  buildAttestationPayload,
  evaluateCreatorVerification,
  verifySep12Attestation,
  verifySep1Identity,
} from "@/lib/identity/verify";
import { toStellarToml, parseStellarToml } from "@/lib/identity/stellarToml";
import type { Sep12Attestation, StellarToml } from "@/lib/identity/types";

function signAttestation(
  attestation: Sep12Attestation,
  signingKey: Keypair,
): Sep12Attestation {
  const payload = buildAttestationPayload(attestation);
  const signature = signingKey.sign(Buffer.from(payload, "utf8")).toString("base64");
  return { ...attestation, signature };
}

const CREATOR = "GCREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATORX";

const TOML_BASE: StellarToml = toStellarToml(
  parseStellarToml(
    `SIGNING_KEY = "GORGSIGNINGKEYORGSIGNINGKEYORGSIGNINGKEYORGSIGNINGKEYORGSIGN"
ACCOUNTS = ["${CREATOR}"]`,
  ),
);

describe("verifySep1Identity", () => {
  it("is true when the creator account is listed", () => {
    expect(
      verifySep1Identity({ account: CREATOR, toml: TOML_BASE }),
    ).toBe(true);
  });

  it("is false when the creator account is absent", () => {
    expect(
      verifySep1Identity({
        account: "GABSENTABSENTABSENTABSENTABSENTABSENTABSENT",
        toml: TOML_BASE,
      }),
    ).toBe(false);
  });
});

describe("verifySep12Attestation", () => {
  const orgKey = Keypair.random();
  const tomlWithKey: StellarToml = {
    ...TOML_BASE,
    signingKey: orgKey.publicKey(),
  };

  const baseAttestation: Sep12Attestation = {
    schema: "sep12-creator-v1",
    domain: "creator.example",
    account: CREATOR,
    name: "Ada Lovelace",
    type: "individual",
    status: "VERIFIED",
    issuedAt: "2026-08-30T00:00:00.000Z",
    signature: "",
  };

  it("verifies a valid signature from the published SIGNING_KEY", () => {
    const signed = signAttestation(baseAttestation, orgKey);
    expect(verifySep12Attestation({ attestation: signed, signingKey: orgKey.publicKey() })).toBe(
      true,
    );
  });

  it("rejects a signature from a different key", () => {
    const signed = signAttestation(baseAttestation, Keypair.random());
    expect(verifySep12Attestation({ attestation: signed, signingKey: orgKey.publicKey() })).toBe(
      false,
    );
  });

  it("rejects when the status is not VERIFIED", () => {
    const pending: Sep12Attestation = { ...baseAttestation, status: "PENDING", signature: "" };
    const signed = signAttestation(pending, orgKey);
    expect(verifySep12Attestation({ attestation: signed, signingKey: orgKey.publicKey() })).toBe(
      false,
    );
  });

  it("rejects a tampered payload", () => {
    const signed = signAttestation(baseAttestation, orgKey);
    const tampered: Sep12Attestation = { ...signed, name: "Evil Hacker" };
    expect(verifySep12Attestation({ attestation: tampered, signingKey: orgKey.publicKey() })).toBe(
      false,
    );
  });

  it("evaluateCreatorVerification returns sep12-attestation when signed", () => {
    const signed = signAttestation(baseAttestation, orgKey);
    const result = evaluateCreatorVerification({
      account: CREATOR,
      toml: tomlWithKey,
      attestation: signed,
      stellarTomlUrl: "https://creator.example/.well-known/stellar.toml",
    });
    expect(result.status).toBe("verified");
    expect(result.method).toBe("sep12-attestation");
    expect(result.name).toBe("Ada Lovelace");
  });

  it("evaluateCreatorVerification returns sep1-toml without an attestation", () => {
    const result = evaluateCreatorVerification({ account: CREATOR, toml: TOML_BASE });
    expect(result.status).toBe("verified");
    expect(result.method).toBe("sep1-toml");
  });

  it("evaluateCreatorVerification returns unverified when account missing", () => {
    const result = evaluateCreatorVerification({
      account: "GABSENTABSENTABSENTABSENTABSENTABSENTABSENT",
      toml: TOML_BASE,
    });
    expect(result.status).toBe("unverified");
  });
});

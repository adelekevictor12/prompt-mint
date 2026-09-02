import { describe, expect, it } from "vitest";
import {
  findCreatorInToml,
  parseStellarToml,
  toStellarToml,
} from "@/lib/identity/stellarToml";

const SAMPLE_TOML = `# Stellar info file
SIGNING_KEY = "GAIGZHHWYKOAPIXKX3TQOLJLFWHYYPVFRXYBL7GBRL3QSEMEVOVQXXDB"
ACCOUNTS = ["GCREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATORX"]
VERSION = "0.1.0"

[[VERIFIED_CREATORS]]
ACCOUNT = "GOTHERCREATOROTHERCREATOROTHERCREATOROTHERCREATOROTHERCREATOROTH"
NAME = "Ada Lovelace"
HANDLE = "ada"

[[DOCUMENTATION]]
ORG_NAME = "Prompt Mint"
`;

describe("parseStellarToml", () => {
  it("parses top-level scalars, arrays, and arrays of tables", () => {
    const parsed = parseStellarToml(SAMPLE_TOML);
    expect(parsed.SIGNING_KEY).toBe(
      "GAIGZHHWYKOAPIXKX3TQOLJLFWHYYPVFRXYBL7GBRL3QSEMEVOVQXXDB",
    );
    expect(Array.isArray(parsed.ACCOUNTS)).toBe(true);
    expect(parsed.VERSION).toBe("0.1.0");
    expect(Array.isArray(parsed.VERIFIED_CREATORS)).toBe(true);
  });

  it("normalizes to a StellarToml with verified creators", () => {
    const toml = toStellarToml(parseStellarToml(SAMPLE_TOML));
    expect(toml.signingKey).toBe(
      "GAIGZHHWYKOAPIXKX3TQOLJLFWHYYPVFRXYBL7GBRL3QSEMEVOVQXXDB",
    );
    expect(toml.accounts).toContain(
      "GCREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATOREXAMPLECREATORX",
    );
    expect(toml.verifiedCreators[0]).toMatchObject({
      account: "GOTHERCREATOROTHERCREATOROTHERCREATOROTHERCREATOROTHERCREATOROTH",
      name: "Ada Lovelace",
    });
  });
});

describe("findCreatorInToml", () => {
  const toml = toStellarToml(parseStellarToml(SAMPLE_TOML));

  it("matches an account declared in ACCOUNTS (case-insensitive)", () => {
    const lower = "gcreatorexamplecreatorexamplecreatorexamplecreatorexamplecreatorx";
    expect(findCreatorInToml(toml, lower).found).toBe(true);
  });

  it("matches an account in VERIFIED_CREATORS and returns its name", () => {
    const other =
      "GOTHERCREATOROTHERCREATOROTHERCREATOROTHERCREATOROTHERCREATOROTH";
    const match = findCreatorInToml(toml, other);
    expect(match.found).toBe(true);
    expect(match.name).toBe("Ada Lovelace");
  });

  it("returns not found for an unrelated account", () => {
    expect(
      findCreatorInToml(toml, "GUNRELATEDUNRELATEDUNRELATEDUNRELATEDUNRELATEDUNRELATED").found,
    ).toBe(false);
  });
});

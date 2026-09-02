import type { StellarToml } from "./types";

/**
 * Minimal TOML parser covering the subset used by SEP-1 `stellar.toml`
 * files: top-level key/value pairs, `[table]` sections, `[[array-of-tables]]`
 * sections, inline arrays of scalars, strings, integers, floats and booleans.
 * It intentionally does not implement every TOML feature — only what creator
 * identity verification needs.
 */
export function parseStellarToml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  const stripComment = (line: string): string => {
    let inString = false;
    let quote = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inString) {
        if (ch === quote) inString = false;
      } else if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
      } else if (ch === "#") {
        return line.slice(0, i);
      }
    }
    return line;
  };

  const parseScalar = (raw: string): unknown => {
    const value = raw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
    if (value === "true") return true;
    if (value === "false") return false;
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (inner === "") return [];
      return inner.split(",").map((part) => parseScalar(part));
    }
    if (/^-?\d+$/.test(value)) return Number(value);
    if (/^-?\d*\.\d+$/.test(value)) return Number(value);
    return value;
  };

  const assign = (key: string, value: unknown) => {
    current[key] = value;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line === "") continue;

    if (line.startsWith("[[")) {
      const name = line.slice(2, line.indexOf("]")).trim();
      const parent: Record<string, unknown> = current;
      const list = (Array.isArray(parent[name]) ? parent[name] : []) as unknown[];
      const next: Record<string, unknown> = {};
      list.push(next);
      parent[name] = list;
      current = next;
      continue;
    }

    if (line.startsWith("[")) {
      const name = line.slice(1, line.indexOf("]")).trim();
      const segments = name.split(".");
      let node: Record<string, unknown> = root;
      for (const segment of segments) {
        if (typeof node[segment] !== "object" || node[segment] === null) {
          node[segment] = {};
        }
        node = node[segment] as Record<string, unknown>;
      }
      current = node;
      continue;
    }

    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    assign(key, parseScalar(value));
  }

  return root;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : String(item)))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

/** Normalize a parsed TOML document into the subset we consume. */
export function toStellarToml(parsed: Record<string, unknown>): StellarToml {
  const verifiedCreatorsRaw = parsed.VERIFIED_CREATORS;
  const verifiedCreators = Array.isArray(verifiedCreatorsRaw)
    ? (verifiedCreatorsRaw as Array<Record<string, unknown>>).map((entry) => ({
        account: typeof entry.ACCOUNT === "string" ? entry.ACCOUNT : undefined,
        name: typeof entry.NAME === "string" ? entry.NAME : undefined,
        handle: typeof entry.HANDLE === "string" ? entry.HANDLE : undefined,
      }))
    : [];

  return {
    signingKey:
      typeof parsed.SIGNING_KEY === "string" ? parsed.SIGNING_KEY : undefined,
    accounts: asStringArray(parsed.ACCOUNTS),
    verifiedCreators,
    ...parsed,
  };
}

export interface TomlAccountMatch {
  found: boolean;
  name?: string;
  handle?: string;
}

/** Check whether a creator account is declared in a parsed `stellar.toml`. */
export function findCreatorInToml(
  toml: StellarToml,
  account: string,
): TomlAccountMatch {
  const normalized = account.trim().toLowerCase();
  if (toml.accounts.some((a) => a.trim().toLowerCase() === normalized)) {
    return { found: true };
  }
  for (const creator of toml.verifiedCreators) {
    if (creator.account && creator.account.trim().toLowerCase() === normalized) {
      return { found: true, name: creator.name, handle: creator.handle };
    }
  }
  return { found: false };
}

/** Fetch and parse a SEP-1 `stellar.toml`. Requires an HTTPS origin. */
export async function fetchStellarToml(url: string): Promise<StellarToml> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid stellar.toml URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("stellar.toml must be served over HTTPS.");
  }

  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Could not fetch stellar.toml (${response.status}).`);
  }
  const text = await response.text();
  return toStellarToml(parseStellarToml(text));
}

import type { CreatorVerification } from "./types";

/**
 * Local persistence of verification claims keyed by creator address. SEP-1/SEP-12
 * verification is fully reproducible from a creator's `stellar.toml`, so this
 * store only caches the result so the verified badge renders consistently across
 * the app on the viewer's device. A backend-indexed claim is a follow-up.
 */

const STORAGE_KEY = "prompthash:creator-verifications";

type VerificationMap = Record<string, CreatorVerification>;

function readMap(): VerificationMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VerificationMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: VerificationMap): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / serialization errors — verification is best-effort cache
  }
}

export function getStoredVerification(address: string): CreatorVerification | null {
  const normalized = address.trim().toLowerCase();
  return readMap()[normalized] ?? null;
}

export function storeVerification(
  address: string,
  verification: CreatorVerification,
): void {
  const normalized = address.trim().toLowerCase();
  const map = readMap();
  map[normalized] = verification;
  writeMap(map);
}

export function clearVerification(address: string): void {
  const normalized = address.trim().toLowerCase();
  const map = readMap();
  delete map[normalized];
  writeMap(map);
}

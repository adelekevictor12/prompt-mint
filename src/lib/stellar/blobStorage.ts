const BLOB_STORAGE_ENDPOINT = import.meta.env.VITE_BLOB_STORAGE_ENDPOINT || "";

export function isBlobReference(value: string): boolean {
  return /^(https?:\/\/|ipfs:\/\/|blob:\/\/|s3:\/\/)/i.test(value.trim());
}

export async function uploadToBlobStorage(ciphertext: string): Promise<string> {
  if (!BLOB_STORAGE_ENDPOINT) {
    throw new Error("VITE_BLOB_STORAGE_ENDPOINT is not configured");
  }

  const response = await fetch(`${BLOB_STORAGE_ENDPOINT}/api/blobs/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: ciphertext }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error");
    throw new Error(`Blob upload failed (${response.status}): ${text}`);
  }

  const result = await response.json();
  return result.reference ?? result.url ?? result.id;
}

export async function fetchFromBlobStorage(ref: string): Promise<string> {
  if (!isBlobReference(ref)) {
    return ref;
  }

  if (ref.startsWith("ipfs://")) {
    const cid = ref.slice(7);
    const gateway = import.meta.env.VITE_IPFS_GATEWAY || "https://ipfs.io/ipfs/";
    const response = await fetch(`${gateway}${encodeURIComponent(cid)}`);
    if (!response.ok) throw new Error(`IPFS fetch failed: ${response.statusText}`);
    return response.text();
  }

  if (ref.startsWith("blob://")) {
    const id = encodeURIComponent(ref.slice(7));
    const endpoint = BLOB_STORAGE_ENDPOINT;
    if (!endpoint) throw new Error("Blob storage endpoint not configured for blob:// references");
    const response = await fetch(`${endpoint}/api/blobs/${id}`);
    if (!response.ok) throw new Error(`Blob fetch failed: ${response.statusText}`);
    return response.text();
  }

  const response = await fetch(ref);
  if (!response.ok) throw new Error(`Blob fetch failed: ${response.statusText}`);
  return response.text();
}

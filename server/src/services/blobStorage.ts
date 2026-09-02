import type { Request, Response } from "express";

const BLOB_STORE = new Map<string, { data: string; createdAt: number }>();

export function uploadBlob(data: string): { reference: string; id: string } {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  BLOB_STORE.set(id, { data, createdAt: Date.now() });
  return { reference: `blob://${id}`, id };
}

export function fetchBlob(id: string): string | undefined {
  const blob = BLOB_STORE.get(id);
  return blob?.data;
}

export async function handleBlobUpload(req: Request, res: Response) {
  const { data } = req.body;
  if (typeof data !== "string" || data.length === 0) {
    res.status(400).json({ error: "Missing or empty blob data" });
    return;
  }

  const result = uploadBlob(data);
  res.status(201).json(result);
}

export async function handleBlobFetch(req: Request, res: Response) {
  const { id } = req.params;
  const data = fetchBlob(id);
  if (data === undefined) {
    res.status(404).json({ error: "Blob not found" });
    return;
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(data);
}

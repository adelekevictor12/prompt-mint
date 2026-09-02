import { withObservability } from "../src/lib/observability/wrapper";
import connectDb from "../server/src/db/connectDb";
import Prompt from "../server/src/models/Prompt";

function getAppUrl(): string {
  return process.env.APP_URL ?? "https://prompthash.io";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getBaseUrls(): string[] {
  return ["/", "/browse", "/sell", "/profile", "/status"];
}

function toIsoDate(value?: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const APP_URL = getAppUrl();
  const urls = getBaseUrls().map((path) => `${APP_URL}${path}`);
  let error: string | null = null;

  try {
    await connectDb();
    const prompts = await Prompt.find({ listingStatus: "published", isActive: true })
      .select("_id updatedAt")
      .lean();

    const listingUrls = prompts.map((prompt: any) => {
      const promptId = String(prompt._id);
      const lastMod = toIsoDate(prompt.updatedAt);
      return {
        loc: `${APP_URL}/browse?promptId=${encodeURIComponent(promptId)}`,
        lastMod,
      };
    });

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`),
      ...listingUrls.map((entry) => {
        const lastModTag = entry.lastMod ? `<lastmod>${escapeXml(entry.lastMod)}</lastmod>` : "";
        return `  <url><loc>${escapeXml(entry.loc)}</loc>${lastModTag}</url>`;
      }),
      '</urlset>',
    ].join("\n");

    res.setHeader("content-type", "application/xml; charset=utf-8");
    res.send(xml);
    return;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unable to build sitemap";
  }

  const fallbackXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`),
    '</urlset>',
  ].join("\n");

  res.setHeader("content-type", "application/xml; charset=utf-8");
  res.setHeader("x-sitemap-error", error ?? "Unknown sitemap error");
  res.send(fallbackXml);
}

export default withObservability(handler, "sitemap");

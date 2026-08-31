import type { QuoteItem } from "./mockQuote";

/** Primary + extra gallery images for a line item (deduped, non-empty). */
export function getQuoteItemImageUrls(
  item: Pick<QuoteItem, "imageUrl" | "extraImageUrls">,
): string[] {
  const urls: string[] = [];
  const primary = item.imageUrl?.trim();
  if (primary) urls.push(primary);

  for (const raw of item.extraImageUrls ?? []) {
    const url = raw?.trim();
    if (url && !urls.includes(url)) urls.push(url);
  }

  return urls;
}

export function normalizeExtraImageUrls(urls: unknown): string[] | null {
  if (!Array.isArray(urls)) return null;
  const cleaned = urls
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return cleaned.length ? [...new Set(cleaned)] : null;
}

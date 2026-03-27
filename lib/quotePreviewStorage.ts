import type { Quote } from "./mockQuote";

export const QUOTE_PREVIEW_STORAGE_KEY = "custom-quote:preview-draft";

export function saveQuoteForPreview(quote: Quote): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(QUOTE_PREVIEW_STORAGE_KEY, JSON.stringify(quote));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadQuoteFromPreviewStorage(): Quote | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(QUOTE_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Quote;
  } catch {
    return null;
  }
}

export function clearQuoteDraft(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(QUOTE_PREVIEW_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Alias for clarity — same key as preview. */
export const saveQuoteDraft = saveQuoteForPreview;
export const loadQuoteDraft = loadQuoteFromPreviewStorage;

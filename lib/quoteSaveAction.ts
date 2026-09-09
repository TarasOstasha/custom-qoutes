import { serializeQuoteItemsForDb, type QuoteItemDbFields } from "./cartImport";

export type QuoteSaveAction =
  | { mode: "update"; quoteId: string; loadedQuoteNumber: string; currentQuoteNumber: string }
  | {
      mode: "save_as_new";
      originalQuoteId: string;
      loadedQuoteNumber: string;
      currentQuoteNumber: string;
    }
  | { mode: "create"; currentQuoteNumber: string };

export function normalizeQuoteNumber(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Decide insert vs update from loaded quote number vs current form quote number.
 * Does not use the form's database id — only loadedQuoteId + quote number comparison.
 */
export function resolveQuoteSaveAction(params: {
  loadedQuoteId: string | null;
  originalLoadedQuoteNumber: string | null;
  currentQuoteNumber: string;
}): QuoteSaveAction {
  const currentQuoteNumber = normalizeQuoteNumber(params.currentQuoteNumber);
  const loadedQuoteNumber = normalizeQuoteNumber(params.originalLoadedQuoteNumber);

  if (params.loadedQuoteId && loadedQuoteNumber) {
    if (currentQuoteNumber === loadedQuoteNumber) {
      return {
        mode: "update",
        quoteId: params.loadedQuoteId,
        loadedQuoteNumber,
        currentQuoteNumber,
      };
    }

    return {
      mode: "save_as_new",
      originalQuoteId: params.loadedQuoteId,
      loadedQuoteNumber,
      currentQuoteNumber,
    };
  }

  return { mode: "create", currentQuoteNumber };
}

export function mapQuoteItemsForCreate(items: QuoteItemDbFields[]) {
  return serializeQuoteItemsForDb(items);
}

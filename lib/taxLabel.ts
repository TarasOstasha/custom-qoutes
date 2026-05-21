/** Subtotal + shipping (after line discounts) — base for %-driven tax in the quote builder. */
export function taxableBase(subtotal: number, discountTotal: number, shippingTotal: number): number {
  return Math.round(Math.max(0, subtotal - discountTotal + shippingTotal) * 100) / 100;
}

/** Parse rate from cart label, e.g. `CA Sales Tax (9.5%)` or `CA Sales Tax (9.5)`. */
export function parseTaxRatePercentFromDescription(
  taxDescription?: string | null
): number | null {
  const text = taxDescription?.trim() ?? "";
  if (!text) return null;
  const match = text.match(/\(([\d.]+)\s*%?\s*\)/);
  if (!match) return null;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export function formatTaxRatePercentInput(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return "";
  return String(rate);
}

export function resolveTaxRatePercent(quote: {
  taxRatePercent?: number | null;
  taxDescription?: string | null;
}): number | null {
  if (quote.taxRatePercent != null && Number.isFinite(quote.taxRatePercent) && quote.taxRatePercent > 0) {
    return quote.taxRatePercent;
  }
  return parseTaxRatePercentFromDescription(quote.taxDescription);
}

function normalizeStateCode(state?: string | null): string {
  const s = state?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

function stateSalesTaxLabel(state: string): string {
  return `${state} Sales Tax`;
}

function taxLabelNeedsStatePrefix(text: string): boolean {
  if (!text) return true;
  if (/^tax$/i.test(text)) return true;
  if (/^sales tax$/i.test(text)) return true;
  return false;
}

/** Row heading from cart `.v65-cart-taxtext-cell b` (e.g. "NJ Sales Tax"), or shipping state. */
export function formatTaxRowLabel(
  taxDescription?: string | null,
  shippingState?: string | null
): string {
  let text = taxDescription?.trim() ? taxDescription.trim().replace(/:\s*$/, "") : "";
  if (text) {
    // Rate is shown in the % field; heading is the jurisdiction name only.
    text = text.replace(/\s*\([^)]*%[^)]*\)\s*$/i, "").trim();
  }

  const state = normalizeStateCode(shippingState);
  if (state && taxLabelNeedsStatePrefix(text)) {
    return stateSalesTaxLabel(state);
  }

  return text || "Tax";
}

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

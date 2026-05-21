import type { QuoteItem } from "./mockQuote";

/** Discount line: $ or % applied to merchandise subtotal (not shipping). */
export function isQuoteDiscountLine(item: QuoteItem): boolean {
  return item.discountScope === "quote";
}

export function isShippingLine(item: QuoteItem): boolean {
  return item.lineType === "custom" && /^shipping$/i.test(item.name.trim());
}

export function formatQuoteDiscountRate(item: QuoteItem): string {
  if (!isQuoteDiscountLine(item)) return "";
  if (item.discountType === "percent") return `${item.discountValue}%`;
  if (item.discountType === "amount") return `$${Math.abs(item.discountValue).toFixed(2)}`;
  return "";
}

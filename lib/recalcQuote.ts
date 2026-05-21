import type { QuoteItem } from "./mockQuote";
import { isQuoteDiscountLine, isShippingLine } from "./quoteDiscount";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcRegularLine(item: QuoteItem) {
  const lineSubtotal = round2(item.qty * item.unitPrice);
  let lineDiscountTotal = 0;

  if (item.discountType === "percent") {
    lineDiscountTotal = round2((lineSubtotal * item.discountValue) / 100);
  } else if (item.discountType === "amount") {
    lineDiscountTotal = round2(item.discountValue);
  }

  if (lineSubtotal >= 0) {
    lineDiscountTotal = Math.min(lineDiscountTotal, lineSubtotal);
  }
  const net = round2(lineSubtotal - lineDiscountTotal);
  const lineTotal = item.lineType === "custom" ? net : round2(Math.max(0, net));
  return { lineSubtotal, lineDiscountTotal, lineTotal };
}

function calcQuoteDiscountLine(item: QuoteItem, merchandiseSubtotal: number) {
  const lineSubtotal = 0;
  const lineDiscountTotal =
    item.discountType === "percent"
      ? round2((merchandiseSubtotal * Math.max(0, item.discountValue)) / 100)
      : item.discountType === "amount"
        ? round2(Math.abs(item.discountValue))
        : 0;
  const lineTotal = round2(-lineDiscountTotal);
  return { lineSubtotal, lineDiscountTotal, lineTotal };
}

/** Recompute line totals and quote-level subtotal / discounts / grand total (shipping & tax from overrides). */
export function recalcQuote(
  items: QuoteItem[],
  overrides?: { shippingTotal?: number; taxTotal?: number }
) {
  const regularTotals = new Map<string, ReturnType<typeof calcRegularLine>>();
  for (const item of items) {
    if (!isQuoteDiscountLine(item)) {
      regularTotals.set(item.id, calcRegularLine(item));
    }
  }

  const merchandiseSubtotal = round2(
    items
      .filter((i) => !isQuoteDiscountLine(i) && !isShippingLine(i))
      .reduce((sum, i) => sum + (regularTotals.get(i.id)?.lineSubtotal ?? 0), 0)
  );

  const mapped = items.map((item) => {
    const totals = isQuoteDiscountLine(item)
      ? calcQuoteDiscountLine(item, merchandiseSubtotal)
      : (regularTotals.get(item.id) ?? calcRegularLine(item));
    return { ...item, ...totals };
  });

  const subtotal = round2(mapped.reduce((s, i) => s + i.lineSubtotal, 0));
  const discountTotal = round2(mapped.reduce((s, i) => s + i.lineDiscountTotal, 0));
  const shippingTotal = round2(Number(overrides?.shippingTotal ?? 0));
  const taxTotal = round2(Number(overrides?.taxTotal ?? 0));
  const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);

  return { items: mapped, subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}

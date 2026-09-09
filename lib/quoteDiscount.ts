import type { QuoteItem } from "./mockQuote";

export type QuoteDiscountFields = {
  discountType: QuoteItem["discountType"];
  discountValue: number;
  discountScope: "quote" | null;
};

export type QuoteDiscountOptionsJson = {
  discount_scope?: "quote";
  discount_type?: "amount" | "percent";
  discount_value?: number;
};

function asFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Discount line: $ or % applied to merchandise subtotal (not shipping). */
export function isQuoteDiscountLine(item: Pick<QuoteItem, "discountScope">): boolean {
  return item.discountScope === "quote";
}

export function looksLikeLegacyQuoteDiscountLine(item: {
  name?: string | null | undefined;
  description?: string | null | undefined;
  sku?: string | null | undefined;
  productCode?: string | null | undefined;
}): boolean {
  const sku = (item.sku ?? item.productCode ?? "").trim();
  if (sku) return false;
  const name = (item.name ?? "").trim();
  const description = (item.description ?? "").trim();
  return /^discount$/i.test(name) || /^quote discount$/i.test(description);
}

export function quoteDiscountFieldsForSave(item: {
  discountType?: string | null | undefined;
  discountValue?: number | null | undefined;
  discountScope?: "quote" | null | undefined;
}): QuoteDiscountOptionsJson {
  if (item.discountScope !== "quote") return {};
  return {
    discount_scope: "quote",
    discount_type: item.discountType === "percent" ? "percent" : "amount",
    discount_value: Math.max(0, asFiniteNumber(item.discountValue)),
  };
}

export function quoteDiscountFieldsFromDb(params: {
  options?: {
    discount_scope?: unknown;
    discount_type?: unknown;
    discount_value?: unknown;
  } | null;
  name?: string | null;
  description?: string | null;
  sku?: string | null;
  unitPrice?: number;
  amount?: number;
}): QuoteDiscountFields {
  if (params.options?.discount_scope === "quote") {
    return {
      discountType: params.options.discount_type === "percent" ? "percent" : "amount",
      discountValue: Math.max(0, asFiniteNumber(params.options.discount_value)),
      discountScope: "quote",
    };
  }

  if (
    looksLikeLegacyQuoteDiscountLine({
      name: params.name,
      description: params.description,
      sku: params.sku,
    })
  ) {
    const fromAmount = Math.abs(asFiniteNumber(params.amount));
    const fromPrice = Math.abs(asFiniteNumber(params.unitPrice));
    return {
      discountType: "amount",
      discountValue: fromAmount || fromPrice,
      discountScope: "quote",
    };
  }

  return { discountType: "none", discountValue: 0, discountScope: null };
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

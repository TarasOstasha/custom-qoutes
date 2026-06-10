import { formatShippingDestination } from "./shippingDestination";

export const SHIPPING_METHOD_OPTIONS = [
  { value: "0", label: "Please Select" },
  { value: "1", label: "Ground" },
  { value: "2", label: "3 Day" },
  { value: "3", label: "2 Day" },
  { value: "4", label: "Next Day" },
  { value: "5", label: "Over Night" },
  { value: "6", label: "Custom" },
] as const;

export type ShippingMethodValue = (typeof SHIPPING_METHOD_OPTIONS)[number]["value"];

export const DEFAULT_SHIPPING_METHOD: ShippingMethodValue = "0";

export function formatShippingMethodLabel(
  value: string | null | undefined,
): string | null {
  if (!value || value === DEFAULT_SHIPPING_METHOD) return null;
  return SHIPPING_METHOD_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

/** Persist only when the user picked a real method (not "Please Select"). */
export function serializeShippingMethodForDb(
  value: string | null | undefined,
): string | null {
  if (!value || value === DEFAULT_SHIPPING_METHOD) return null;
  return value;
}

export function parseShippingMethodFromDb(
  value: string | null | undefined,
): ShippingMethodValue {
  if (!value) return DEFAULT_SHIPPING_METHOD;
  return SHIPPING_METHOD_OPTIONS.some((option) => option.value === value)
    ? (value as ShippingMethodValue)
    : DEFAULT_SHIPPING_METHOD;
}

type ShippingRowQuote = {
  shippingMethod?: string | null;
  shippingState?: string | null;
  shippingZip?: string | null;
};

/** Method and destination suffix for preview / exports (omits "Please Select"). */
export function formatShippingRowAnnotation(quote: ShippingRowQuote): string | null {
  const parts = [
    formatShippingMethodLabel(quote.shippingMethod),
    formatShippingDestination(quote.shippingState, quote.shippingZip),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Left-column shipping label for PDF / Excel totals. */
export function formatShippingTotalLabel(quote: ShippingRowQuote): string {
  const annotation = formatShippingRowAnnotation(quote);
  return annotation ? `Shipping · ${annotation}` : "Shipping";
}

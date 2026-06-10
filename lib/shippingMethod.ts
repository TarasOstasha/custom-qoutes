import type { CartPayload, CartShippingOption } from "./extractCartFromPage";
import { formatShippingDestination } from "./shippingDestination";

/** Manual builder option — always rendered last in the shipping dropdown. */
export const CUSTOM_SHIPPING_METHOD_VALUE = "6";

/** Static builder options (cart-imported methods are inserted before Custom). */
export const SHIPPING_METHOD_OPTIONS = [{ value: CUSTOM_SHIPPING_METHOD_VALUE, label: "Custom" }] as const;

export type ShippingMethodValue = (typeof SHIPPING_METHOD_OPTIONS)[number]["value"];

/** Unset / please-select sentinel — not shown as a dropdown row when cart supplies options. */
export const DEFAULT_SHIPPING_METHOD = "0";

export function mergeCartShippingOptions(
  existing: CartShippingOption[] | null | undefined,
  incoming: CartShippingOption[] | null | undefined,
): CartShippingOption[] {
  const merged = new Map<string, CartShippingOption>();
  for (const option of existing ?? []) {
    if (option.value) merged.set(option.value, option);
  }
  for (const option of incoming ?? []) {
    if (option.value) merged.set(option.value, option);
  }
  return Array.from(merged.values());
}

/** Compact dropdown label — strips dollar/trailing amounts and the word "Shipping". */
export function formatShippingOptionDisplayLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;

  const cleaned = trimmed
    .replace(/\$\s*[\d,]+(?:\.\d{2})?/g, "")
    .replace(/[\d,]+\.\d{2}\s*$/, "")
    .replace(/\bshipping\b/gi, "")
    .replace(/\s*[-–—]+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || trimmed;
}

/** Cart options first, then Custom always last. */
export function buildShippingMethodSelectOptions(
  cartOptions?: CartShippingOption[] | null,
): Array<{ value: string; label: string }> {
  const staticValues = new Set<string>(SHIPPING_METHOD_OPTIONS.map((option) => option.value));
  const leadingStatic = SHIPPING_METHOD_OPTIONS.filter(
    (option) => option.value !== CUSTOM_SHIPPING_METHOD_VALUE,
  ).map((option) => ({ value: option.value, label: option.label }));
  const cart = (cartOptions ?? [])
    .filter((option) => option.value && !staticValues.has(option.value))
    .map((option) => ({ value: option.value, label: option.label }));
  const customOption = SHIPPING_METHOD_OPTIONS.find(
    (option) => option.value === CUSTOM_SHIPPING_METHOD_VALUE,
  );
  const trailingCustom = customOption
    ? [{ value: customOption.value, label: customOption.label }]
    : [];

  return [...leadingStatic, ...cart, ...trailingCustom];
}

export function formatShippingMethodLabel(
  value: string | null | undefined,
  cartOptions?: CartShippingOption[] | null,
): string | null {
  if (!value || value === DEFAULT_SHIPPING_METHOD) return null;
  const staticLabel = SHIPPING_METHOD_OPTIONS.find((option) => option.value === value)?.label;
  if (staticLabel) return staticLabel;
  return cartOptions?.find((option) => option.value === value)?.label ?? null;
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
): string {
  if (!value) return DEFAULT_SHIPPING_METHOD;
  return value;
}

export function parseShippingOptionsFromDb(value: unknown): CartShippingOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: CartShippingOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const optionValue = String(row.value ?? "").trim();
    const label = String(row.label ?? "").trim();
    if (!optionValue || !label) continue;
    const price = Number(row.price);
    const option: CartShippingOption = { value: optionValue, label };
    if (Number.isFinite(price) && price > 0) option.price = price;
    if (row.selected === true) option.selected = true;
    options.push(option);
  }
  return options.length ? options : null;
}

type ShippingRowQuote = {
  shippingMethod?: string | null;
  shippingOptions?: CartShippingOption[] | null;
  shippingState?: string | null;
  shippingZip?: string | null;
};

/** Method and destination suffix for preview / exports (omits "Please Select"). */
export function formatShippingRowAnnotation(quote: ShippingRowQuote): string | null {
  const parts = [
    formatShippingMethodLabel(quote.shippingMethod, quote.shippingOptions),
    formatShippingDestination(quote.shippingState, quote.shippingZip),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Left-column shipping label for PDF / Excel totals. */
export function formatShippingTotalLabel(quote: ShippingRowQuote): string {
  const annotation = formatShippingRowAnnotation(quote);
  return annotation ? `Shipping · ${annotation}` : "Shipping";
}

export function findCartShippingOption(
  cartOptions: CartShippingOption[] | null | undefined,
  value: string | null | undefined,
): CartShippingOption | null {
  if (!value) return null;
  return cartOptions?.find((option) => option.value === value) ?? null;
}

export function shippingPricesMatch(a: number, b: number, tolerance = 0.02): boolean {
  const left = Math.round(a * 100) / 100;
  const right = Math.round(b * 100) / 100;
  return Math.abs(left - right) <= tolerance;
}

/** Match the applied cart shipping total to a single dropdown option price. */
export function findShippingOptionByPrice(
  shippingOptions: CartShippingOption[] | null | undefined,
  shippingTotal: number,
): CartShippingOption | null {
  if (!shippingOptions?.length || !(shippingTotal > 0)) return null;
  const matches = shippingOptions.filter(
    (option) =>
      option.price != null &&
      option.price > 0 &&
      shippingPricesMatch(option.price, shippingTotal),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function markSelectedShippingOption(
  shippingOptions: CartShippingOption[],
  selectedValue: string,
): CartShippingOption[] {
  return shippingOptions.map((option) => ({
    ...option,
    selected: Boolean(selectedValue && option.value === selectedValue),
  }));
}

/** Align selected method with the shipping total shown in cart totals when they disagree. */
export function reconcileShippingSelectionWithTotal(
  shippingOptions: CartShippingOption[] | null | undefined,
  shippingTotal: number,
  selectedValue?: string | null,
): {
  shippingOptions: CartShippingOption[] | null;
  selectedShippingValue: string;
  selectedShippingOption: CartShippingOption | null;
} {
  const options = shippingOptions ?? [];
  const byPrice = findShippingOptionByPrice(options, shippingTotal);
  if (byPrice?.value) {
    const current = selectedValue?.trim();
    const currentOption = current ? findCartShippingOption(options, current) : null;
    const currentPrice = currentOption?.price ?? 0;
    const priceMismatch =
      shippingTotal > 0 &&
      currentPrice > 0 &&
      !shippingPricesMatch(currentPrice, shippingTotal);
    if (!current || priceMismatch || current === DEFAULT_SHIPPING_METHOD) {
      const marked = markSelectedShippingOption(options, byPrice.value);
      return {
        shippingOptions: marked,
        selectedShippingValue: byPrice.value,
        selectedShippingOption: { ...byPrice, selected: true },
      };
    }
  }

  const resolvedValue = selectedValue?.trim() || "";
  const selectedShippingOption =
    findCartShippingOption(options, resolvedValue) ??
    options.find((option) => option.selected) ??
    null;
  return {
    shippingOptions: resolvedValue
      ? markSelectedShippingOption(options, resolvedValue)
      : options.length
        ? options
        : null,
    selectedShippingValue: resolvedValue,
    selectedShippingOption,
  };
}

/** Pick the cart-marked selection from stored shipping options. */
export function resolveShippingMethodFromShippingOptions(
  shippingOptions?: CartShippingOption[] | null,
  fallback: string = DEFAULT_SHIPPING_METHOD,
  shippingTotal?: number,
): string {
  if (shippingTotal != null && shippingTotal > 0) {
    const byPrice = findShippingOptionByPrice(shippingOptions, shippingTotal);
    if (byPrice?.value) return byPrice.value;
  }

  const selected = shippingOptions?.find((option) => option.selected)?.value?.trim();
  if (selected && selected !== DEFAULT_SHIPPING_METHOD) return selected;

  const realOptions = (shippingOptions ?? []).filter(
    (option) => option.value && option.value !== DEFAULT_SHIPPING_METHOD,
  );
  if (realOptions.length === 1) return realOptions[0]?.value ?? fallback;

  return fallback;
}

type ShippingMethodQuote = {
  shippingMethod?: string | null;
  shippingOptions?: CartShippingOption[] | null;
  shippingTotal?: number;
};

/** Builder select value — prefers explicit method when it matches total, else price match. */
export function resolveEffectiveShippingMethod(
  quote: ShippingMethodQuote,
  fallback: string = DEFAULT_SHIPPING_METHOD,
): string {
  const method = quote.shippingMethod?.trim();
  if (method && method !== DEFAULT_SHIPPING_METHOD) {
    const option = findCartShippingOption(quote.shippingOptions, method);
    const total = quote.shippingTotal ?? 0;
    if (
      total > 0 &&
      option?.price != null &&
      option.price > 0 &&
      !shippingPricesMatch(option.price, total)
    ) {
      const byPrice = findShippingOptionByPrice(quote.shippingOptions, total);
      if (byPrice?.value) return byPrice.value;
    }
    return method;
  }

  return resolveShippingMethodFromShippingOptions(
    quote.shippingOptions,
    fallback,
    quote.shippingTotal,
  );
}

/** Default shipping select value after importing a Volusion cart payload. */
export function resolveShippingMethodFromCartPayload(
  payload: Pick<
    CartPayload,
    "selectedShippingValue" | "selectedShippingOption" | "shippingOptions" | "shippingTotal"
  >,
  fallback: string = DEFAULT_SHIPPING_METHOD,
): string {
  if (payload.shippingTotal != null && payload.shippingTotal > 0) {
    const byPrice = findShippingOptionByPrice(payload.shippingOptions, payload.shippingTotal);
    if (byPrice?.value) return byPrice.value;
  }

  const candidates = [
    payload.selectedShippingValue?.trim(),
    payload.selectedShippingOption?.value?.trim(),
    payload.shippingOptions?.find((option) => option.selected)?.value?.trim(),
  ];
  for (const candidate of candidates) {
    if (candidate && candidate !== DEFAULT_SHIPPING_METHOD) return candidate;
  }

  const realOptions = (payload.shippingOptions ?? []).filter(
    (option) => option.value && option.value !== DEFAULT_SHIPPING_METHOD,
  );
  if (realOptions.length === 1) return realOptions[0]?.value ?? fallback;

  return fallback;
}

export function cartPayloadHasShippingChoice(
  payload: Pick<
    CartPayload,
    "selectedShippingValue" | "selectedShippingOption" | "shippingOptions"
  >,
): boolean {
  return Boolean(
    payload.selectedShippingValue ||
      payload.selectedShippingOption?.value ||
      payload.shippingOptions?.some((option) => option.selected) ||
      payload.shippingOptions?.some(
        (option) => option.value && option.value !== DEFAULT_SHIPPING_METHOD,
      ),
  );
}

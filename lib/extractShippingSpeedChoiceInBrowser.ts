import type { ShippingOption } from "./shippingOptions";

export const SHIPPING_SPEED_SELECT_SELECTOR =
  'select[name="ShippingSpeedChoice"], select.browser-default[name="ShippingSpeedChoice"]';

export type ShippingSpeedChoiceScrape = {
  shippingOptions: ShippingOption[];
  selectedShippingValue: string;
  selectedShippingOption: ShippingOption | null;
  shippingTotal: number;
};

/**
 * Minimal Volusion shipping scrape — self-contained for Playwright `page.evaluate()`.
 * Targets: select.browser-default[name="ShippingSpeedChoice"]
 */
export function extractShippingSpeedChoiceInBrowser(): ShippingSpeedChoiceScrape | null {
  const select = document.querySelector(SHIPPING_SPEED_SELECT_SELECTOR) as HTMLSelectElement | null;
  if (!select) return null;

  function optionLabel(option: HTMLOptionElement): string {
    return (option.label || option.textContent || "").replace(/\s+/g, " ").trim();
  }

  function parsePrice(label: string): number {
    const dollarMatches = [...label.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
    const priceToken =
      dollarMatches.length > 0
        ? dollarMatches[dollarMatches.length - 1]?.[1]
        : label.match(/([\d,]+\.\d{2})\s*$/)?.[1];
    if (!priceToken) return 0;
    const n = parseFloat(priceToken.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  const shippingOptions: ShippingOption[] = [];

  Array.from(select.options).forEach((option) => {
    const value = (option.value ?? "").trim();
    const label = optionLabel(option);
    if (!value || value === "0" || /^please\s*select/i.test(label)) return;

    const price = parsePrice(label);
    if (price <= 0) return;

    shippingOptions.push({ value, label, price });
  });

  if (!shippingOptions.length) return null;

  let selectedShippingValue = "";
  let shippingTotal = 0;

  const selectedEl =
    select.selectedIndex >= 0 ? select.options.item(select.selectedIndex) : null;
  const selectedByAttr = select.querySelector("option[selected]") as HTMLOptionElement | null;
  const selected = selectedEl ?? selectedByAttr;

  if (selected) {
    const selectedValue = (selected.value ?? "").trim();
    const selectedLabel = optionLabel(selected);
    if (selectedValue && selectedValue !== "0" && !/^please\s*select/i.test(selectedLabel)) {
      const match =
        shippingOptions.find((option) => option.value === selectedValue) ??
        shippingOptions.find((option) => option.label === selectedLabel);
      if (match) {
        selectedShippingValue = match.value;
        shippingTotal = match.price ?? 0;
      }
    }
  }

  const shippingOptionsMarked = shippingOptions.map((option) => ({
    ...option,
    selected: Boolean(selectedShippingValue && option.value === selectedShippingValue),
  }));
  const selectedShippingOption =
    shippingOptionsMarked.find((option) => option.selected) ?? null;

  return {
    shippingOptions: shippingOptionsMarked,
    selectedShippingValue,
    selectedShippingOption,
    shippingTotal,
  };
}

type ShippingPayloadFields = {
  shippingTotal: number;
  shippingOptions?: ShippingOption[];
  selectedShippingValue?: string;
  selectedShippingOption?: ShippingOption | null;
};

export function applyShippingSpeedChoiceToPayload(
  payload: ShippingPayloadFields,
  scrape: ShippingSpeedChoiceScrape
): void {
  payload.shippingOptions = scrape.shippingOptions;
  if (scrape.selectedShippingValue) {
    payload.selectedShippingValue = scrape.selectedShippingValue;
    payload.selectedShippingOption = scrape.selectedShippingOption;
  }
  if (scrape.shippingTotal > 0 && payload.shippingTotal <= 0) {
    payload.shippingTotal = scrape.shippingTotal;
  }
}

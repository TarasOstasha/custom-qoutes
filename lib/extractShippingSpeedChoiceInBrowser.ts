import type { Page } from "playwright";
import type { CartPayload, CartShippingOption } from "./extractCartFromPage";
import { shippingPricesMatch } from "./shippingMethod";

export const SHIPPING_SPEED_SELECT_SELECTOR =
  'select[name="ShippingSpeedChoice"], select.browser-default[name="ShippingSpeedChoice"]';

export type ShippingSpeedChoiceScrape = {
  shippingOptions: CartShippingOption[];
  selectedShippingValue: string;
  selectedShippingOption: CartShippingOption | null;
  shippingTotal: number;
};

/**
 * Self-contained Volusion shipping scrape for Playwright `page.evaluate()`.
 * Do not reference module-level bindings inside (serialization runs in page context).
 */
export function extractShippingSpeedChoiceInBrowser(): ShippingSpeedChoiceScrape | null {
  function findShippingSpeedSelect(): HTMLSelectElement | null {
    const queries = [
      '#v65-cart-shipping-details select[name="ShippingSpeedChoice"]',
      '#v65-cart-shipping-details select.browser-default[name="ShippingSpeedChoice"]',
      "#v65-cart-shipping-details-wrapper select[name=\"ShippingSpeedChoice\"]",
      "td.v65-cart-shipping-details-input-cell select[name=\"ShippingSpeedChoice\"]",
      'select.browser-default[name="ShippingSpeedChoice"]',
      'select[name="ShippingSpeedChoice"]',
    ];
    for (const query of queries) {
      const el = document.querySelector(query);
      if (el instanceof HTMLSelectElement && el.options.length > 0) return el;
    }
    return null;
  }

  function optionLabel(option: HTMLOptionElement): string {
    return (option.label || option.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isPleaseSelectOption(option: HTMLOptionElement | null): boolean {
    if (!option) return true;
    const value = (option.value ?? "").trim();
    const label = optionLabel(option);
    return !value || value === "0" || /^please\s*select/i.test(label);
  }

  function optionIsMarkedSelected(option: HTMLOptionElement): boolean {
    if (option.selected) return true;
    if (option.hasAttribute("selected")) return true;
    const attr = (option.getAttribute("selected") ?? "").trim().toLowerCase();
    return attr !== "" && attr !== "false";
  }

  function findSelectedOption(select: HTMLSelectElement): HTMLOptionElement | null {
    const options = Array.from(select.options);
    for (const option of options) {
      if (optionIsMarkedSelected(option) && !isPleaseSelectOption(option)) return option;
    }
    const indexed = select.selectedIndex >= 0 ? select.options.item(select.selectedIndex) : null;
    if (indexed && !isPleaseSelectOption(indexed)) return indexed;
    return null;
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

  function toCartOption(option: HTMLOptionElement): CartShippingOption {
    const value = (option.value ?? "").trim();
    const label = optionLabel(option);
    const price = parsePrice(label);
    return price > 0 ? { value, label, price } : { value, label };
  }

  const select = findShippingSpeedSelect();
  if (!select) return null;

  const shippingOptions: CartShippingOption[] = [];
  Array.from(select.options).forEach((option) => {
    if (isPleaseSelectOption(option)) return;
    shippingOptions.push(toCartOption(option));
  });
  if (!shippingOptions.length) return null;

  let selectedShippingValue = "";
  let shippingTotal = 0;
  let selectedShippingOption: CartShippingOption | null = null;
  const selectedDom = findSelectedOption(select);

  if (selectedDom) {
    const selectedValue = (selectedDom.value ?? "").trim();
    const selectedLabel = optionLabel(selectedDom);
    if (selectedValue && selectedValue !== "0") {
      let match =
        shippingOptions.find((option) => option.value === selectedValue) ??
        shippingOptions.find((option) => option.label === selectedLabel);
      if (!match) {
        match = toCartOption(selectedDom);
        shippingOptions.push(match);
      }
      selectedShippingValue = match.value;
      shippingTotal = match.price ?? 0;
      selectedShippingOption = { ...match, selected: true };
    }
  }

  if (!selectedShippingValue && shippingOptions.length === 1) {
    const only = shippingOptions[0];
    if (only) {
      selectedShippingValue = only.value;
      shippingTotal = only.price ?? 0;
      selectedShippingOption = { ...only, selected: true };
    }
  }

  const shippingOptionsMarked = shippingOptions.map((option) => ({
    ...option,
    selected: Boolean(selectedShippingValue && option.value === selectedShippingValue),
  }));
  if (!selectedShippingOption) {
    selectedShippingOption = shippingOptionsMarked.find((option) => option.selected) ?? null;
  }

  return {
    shippingOptions: shippingOptionsMarked,
    selectedShippingValue,
    selectedShippingOption,
    shippingTotal,
  };
}

export function applyShippingSpeedChoiceToPayload(
  payload: CartPayload,
  scrape: ShippingSpeedChoiceScrape,
): void {
  payload.shippingOptions = scrape.shippingOptions;
  if (scrape.selectedShippingValue) {
    payload.selectedShippingValue = scrape.selectedShippingValue;
    payload.selectedShippingOption = scrape.selectedShippingOption;
  }
  if (scrape.shippingTotal > 0) {
    const summaryTotal = payload.shippingTotal ?? 0;
    if (summaryTotal === 0 || shippingPricesMatch(summaryTotal, scrape.shippingTotal)) {
      payload.shippingTotal = scrape.shippingTotal;
    }
  }
}

/** Playwright locator fallback when in-page evaluate misses `option[selected]`. */
export async function scrapeShippingSpeedChoiceFromPage(
  page: Page,
): Promise<ShippingSpeedChoiceScrape | null> {
  const select = page.locator(SHIPPING_SPEED_SELECT_SELECTOR).first();
  if ((await select.count()) === 0) return null;

  return select.evaluate((el: HTMLSelectElement) => {
    function label(option: HTMLOptionElement): string {
      return (option.label || option.textContent || "").replace(/\s+/g, " ").trim();
    }
    function isPleaseSelect(option: HTMLOptionElement): boolean {
      const value = (option.value ?? "").trim();
      return !value || value === "0" || /^please\s*select/i.test(label(option));
    }
    function isMarkedSelected(option: HTMLOptionElement): boolean {
      if (option.selected) return true;
      if (option.hasAttribute("selected")) return true;
      const attr = (option.getAttribute("selected") ?? "").trim().toLowerCase();
      return attr !== "" && attr !== "false";
    }
    function parsePrice(text: string): number {
      const dollarMatches = [...text.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
      const priceToken =
        dollarMatches.length > 0
          ? dollarMatches[dollarMatches.length - 1]?.[1]
          : text.match(/([\d,]+\.\d{2})\s*$/)?.[1];
      if (!priceToken) return 0;
      const n = parseFloat(priceToken.replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    }

    const options: Array<{ value: string; label: string; price?: number; selected?: boolean }> =
      [];
    for (const option of Array.from(el.options)) {
      if (isPleaseSelect(option)) continue;
      const value = (option.value ?? "").trim();
      const optionLabel = label(option);
      const price = parsePrice(optionLabel);
      options.push(price > 0 ? { value, label: optionLabel, price } : { value, label: optionLabel });
    }
    if (!options.length) return null;

    let selected = Array.from(el.options).find(
      (option) => isMarkedSelected(option) && !isPleaseSelect(option),
    );
    if (!selected && el.selectedIndex >= 0) {
      const indexed = el.options.item(el.selectedIndex);
      if (indexed && !isPleaseSelect(indexed)) selected = indexed;
    }

    let selectedShippingValue = "";
    let shippingTotal = 0;
    let selectedShippingOption: (typeof options)[number] | null = null;

    if (selected) {
      const value = (selected.value ?? "").trim();
      const selectedLabel = label(selected);
      let match =
        options.find((option) => option.value === value) ??
        options.find((option) => option.label === selectedLabel);
      if (!match) {
        const price = parsePrice(selectedLabel);
        match = price > 0 ? { value, label: selectedLabel, price } : { value, label: selectedLabel };
        options.push(match);
      }
      selectedShippingValue = match.value;
      shippingTotal = match.price ?? 0;
      selectedShippingOption = { ...match, selected: true };
    } else if (options.length === 1) {
      const only = options[0];
      if (only) {
        selectedShippingValue = only.value;
        shippingTotal = only.price ?? 0;
        selectedShippingOption = { ...only, selected: true };
      }
    }

    const shippingOptions = options.map((option) => ({
      ...option,
      selected: Boolean(selectedShippingValue && option.value === selectedShippingValue),
    }));

    return {
      shippingOptions,
      selectedShippingValue,
      selectedShippingOption:
        selectedShippingOption ??
        shippingOptions.find((option) => option.selected) ??
        null,
      shippingTotal,
    };
  });
}

export async function enrichPayloadWithShippingSpeedChoice(
  page: Page,
  payload: CartPayload,
): Promise<void> {
  let scrape = await page.evaluate(extractShippingSpeedChoiceInBrowser);
  if (!scrape?.selectedShippingValue) {
    scrape = (await scrapeShippingSpeedChoiceFromPage(page)) ?? scrape;
  }
  if (scrape) {
    applyShippingSpeedChoiceToPayload(payload, scrape);
  }
}

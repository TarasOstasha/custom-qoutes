export type ShippingOption = {

  label: string;

  value: string;

  price: number | null;

  selected?: boolean;

  isCustom?: boolean;

};



export const SHIPPING_CUSTOM_VALUE = "custom";



export const CUSTOM_SHIPPING_OPTION: ShippingOption = {

  label: "Custom",

  value: SHIPPING_CUSTOM_VALUE,

  price: null,

  isCustom: true,

};



export function isPlaceholderShippingOption(label: string): boolean {

  return /^please\s*select/i.test(label) || /^select\s+/i.test(label);

}



export function shippingOptionPrice(option: ShippingOption): number {

  return option.price != null && Number.isFinite(option.price) ? option.price : 0;

}



export function isScrapedShippingOption(option: ShippingOption): boolean {

  return !option.isCustom && option.value !== SHIPPING_CUSTOM_VALUE;

}



/** Scraped cart options plus a single Custom entry (never duplicated). */

export function buildShippingDropdownOptions(options: ShippingOption[] | undefined | null): ShippingOption[] {

  const scraped = (options ?? []).filter(isScrapedShippingOption);

  return [...scraped, CUSTOM_SHIPPING_OPTION];

}



export function resolveDefaultShippingSelection(

  options: ShippingOption[],

  shippingTotal: number,

  selectedValue?: string | null,

  selectedLabel?: string | null

): string | null {

  const scraped = options.filter(isScrapedShippingOption);

  if (!scraped.length) {

    return shippingTotal > 0 || selectedValue ? SHIPPING_CUSTOM_VALUE : null;

  }



  if (shippingTotal > 0) {

    const byAmount = scraped.find(

      (option) => Math.abs(shippingOptionPrice(option) - shippingTotal) < 0.02

    );

    if (byAmount) return byAmount.value;

  }



  if (selectedValue && selectedValue !== SHIPPING_CUSTOM_VALUE) {

    const byValue = scraped.find((option) => option.value === selectedValue);

    if (byValue) return byValue.value;



    if (selectedLabel && !isPlaceholderShippingOption(selectedLabel)) {

      const byLabel = scraped.find((option) => option.label === selectedLabel);

      if (byLabel) return byLabel.value;

    }

  }



  const preselected = scraped.find((option) => option.selected);

  if (preselected) return preselected.value;



  return scraped[0]?.value ?? SHIPPING_CUSTOM_VALUE;

}



/** Normalize scraped/API payloads (supports legacy `amount` field). */

export function normalizeShippingOptions(raw: unknown): ShippingOption[] {

  if (!Array.isArray(raw)) return [];

  return raw

    .map((entry) => {

      if (!entry || typeof entry !== "object") return null;

      const row = entry as Record<string, unknown>;

      const label = String(row.label ?? "").trim();

      const value = String(row.value ?? "").trim();

      if (!label || !value || row.isCustom || value === SHIPPING_CUSTOM_VALUE || value === "0") return null;

      const priceRaw = row.price ?? row.amount;

      const price =

        priceRaw === null || priceRaw === undefined ? null : Number(priceRaw);

      if (price !== null && (!Number.isFinite(price) || price <= 0)) return null;

      if (isPlaceholderShippingOption(label)) return null;

      return {

        label,

        value,

        price,

        ...(row.selected ? { selected: true } : {}),

      } as ShippingOption;

    })

    .filter((option): option is ShippingOption => option !== null);

}



export function mergeShippingOptions(

  incoming: ShippingOption[],

  existing: ShippingOption[] | undefined | null

): ShippingOption[] {

  const normalizedIncoming = normalizeShippingOptions(incoming);

  if (normalizedIncoming.length) return normalizedIncoming;

  return normalizeShippingOptions(existing ?? []);

}



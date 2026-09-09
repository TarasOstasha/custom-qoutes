import type { CartItemRow } from "./extractCartFromPage";
import type { QuoteItem } from "./mockQuote";
import { quoteDiscountFieldsForSave, quoteDiscountFieldsFromDb } from "./quoteDiscount";
import { normalizeExtraImageUrls } from "./quoteItemImages";
import { round2 } from "./recalcQuote";

/** Volusion cart lines must have a positive EACH/TOTAL price; option sub-rows repeat the SKU at $0. */
export function isImportableVolusionCartRow(params: {
  unitPrice: number;
  lineTotal: number;
}): boolean {
  return params.unitPrice > 0 || params.lineTotal > 0;
}

/** Fallback when Volusion does not expose a cart row id in the DOM. */
export function buildStableCartLineId(row: CartItemRow, rowIndex: number): string {
  const productCode = (row.productCode ?? "").trim().toLowerCase() || "item";
  const unitCents = Math.round((row.unitPrice ?? 0) * 100);
  const totalCents = Math.round((row.lineTotal ?? 0) * 100);
  const optionsKey =
    (row.options ?? [])
      .map((option) => option.trim().toLowerCase())
      .filter(Boolean)
      .join("|")
      .slice(0, 120)
      .replace(/\W+/g, "_") || "noopts";
  return `import_${productCode}_r${rowIndex}_p${unitCents}_t${totalCents}_${optionsKey}`;
}

export function resolveCartLineId(row: CartItemRow, rowIndex: number): string {
  const fromRow = (row.cartLineId ?? "").trim();
  if (fromRow) return fromRow;
  return buildStableCartLineId(row, rowIndex);
}

function normalizeMatchValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function uniqueOptionList(rows: CartItemRow[]): string[] {
  const unique = new Set<string>();
  for (const row of rows) {
    for (const option of row.options ?? []) {
      const normalized = option.trim();
      if (normalized) unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function rowsWithOptions(rows: CartItemRow[]): CartItemRow[] {
  return rows.filter((row) => (row.options ?? []).some((option) => option.trim()));
}

export function findCartRowForQuoteItem(
  item: Pick<QuoteItem, "importLineId" | "sku" | "sourceProductId" | "unitPrice" | "chosenOptions" | "name">,
  cartItems: CartItemRow[],
): CartItemRow | undefined {
  const importLineId = (item.importLineId ?? "").trim();
  if (importLineId) {
    const byStoredId = cartItems.find((row) => (row.cartLineId ?? "").trim() === importLineId);
    if (byStoredId) return byStoredId;
    const byResolved = cartItems.find((row, index) => resolveCartLineId(row, index) === importLineId);
    if (byResolved) return byResolved;
  }

  const sku = normalizeMatchValue(item.sku ?? item.sourceProductId);
  const unitPrice = Number(item.unitPrice);
  const skuMatches = sku
    ? cartItems.filter((row) => normalizeMatchValue(row.productCode) === sku)
    : [];
  if (sku && Number.isFinite(unitPrice) && unitPrice > 0) {
    const pricedMatch = skuMatches.find((row) => Math.abs((row.unitPrice ?? 0) - unitPrice) < 0.01);
    if (pricedMatch) return pricedMatch;
  }
  if (skuMatches.length === 1) return skuMatches[0];

  const name = normalizeMatchValue(item.name);
  if (name) {
    const nameMatches = cartItems.filter((row) => normalizeMatchValue(row.name) === name);
    if (nameMatches.length === 1) return nameMatches[0];
  }

  return undefined;
}

export function collectOptionsForCartLine(
  item: Pick<
    QuoteItem,
    "importLineId" | "sku" | "sourceProductId" | "unitPrice" | "chosenOptions" | "availableOptions" | "name"
  >,
  cartItems: CartItemRow[],
): string[] {
  if (item.availableOptions?.length) {
    return item.availableOptions.map((option) => option.trim()).filter(Boolean);
  }

  const exactRow = findCartRowForQuoteItem(item, cartItems);
  if (exactRow?.options?.length) {
    return exactRow.options.map((option) => option.trim()).filter(Boolean);
  }

  const sku = normalizeMatchValue(item.sku ?? item.sourceProductId);
  const unitPrice = Number(item.unitPrice);
  const skuMatches = rowsWithOptions(
    sku ? cartItems.filter((row) => normalizeMatchValue(row.productCode) === sku) : [],
  );
  if (skuMatches.length) {
    if (Number.isFinite(unitPrice) && unitPrice > 0) {
      const priced = skuMatches.filter((row) => Math.abs((row.unitPrice ?? 0) - unitPrice) < 0.01);
      if (priced.length) return uniqueOptionList(priced);
    }
    return uniqueOptionList(skuMatches);
  }

  const name = normalizeMatchValue(item.name);
  const nameMatches = rowsWithOptions(
    name ? cartItems.filter((row) => normalizeMatchValue(row.name) === name) : [],
  );
  if (nameMatches.length) return uniqueOptionList(nameMatches);

  if (item.chosenOptions?.length) {
    return item.chosenOptions.map((option) => option.trim()).filter(Boolean);
  }
  return [];
}

export type MapCartRowsParams = {
  cartItems: CartItemRow[];
  quoteId: string;
  startSortOrder: number;
  now?: string;
  idPrefix?: string;
};

export function mapCartRowsToQuoteItems(params: MapCartRowsParams): QuoteItem[] {
  const { cartItems, quoteId, startSortOrder } = params;
  const now = params.now ?? new Date().toISOString();
  const idPrefix = params.idPrefix ?? "qi_scrape";
  const importBatch = Date.now();

  const rows = cartItems.filter((row) => {
    const productCode = (row.productCode ?? "").trim();
    const name = (row.name ?? "").trim();
    if (!productCode && !name) return false;
    if (/^empty my entire cart$/i.test(name)) return false;
    if (!isImportableVolusionCartRow({ unitPrice: row.unitPrice, lineTotal: row.lineTotal })) return false;
    return true;
  });

  return rows.map((row, index) => {
    const importLineId = resolveCartLineId(row, index);
    const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 1;
    const unitPrice =
      Number.isFinite(row.unitPrice) && row.unitPrice > 0
        ? row.unitPrice
        : qty > 0 && Number.isFinite(row.lineTotal)
          ? round2(row.lineTotal / qty)
          : 0;
    const lineSubtotal = round2(unitPrice * qty);

    const availableOptions = (row.options ?? []).map((option) => option.trim()).filter(Boolean);

    return {
      id: `${idPrefix}_${importBatch}_${index}`,
      quoteId,
      lineType: "product" as const,
      sourceProductId: row.productCode || null,
      sku: row.productCode || null,
      importLineId,
      imageUrl: row.imageUrl ?? null,
      name: row.name || row.productCode || "Cart Item",
      description: null,
      chosenOptions: null,
      availableOptions: availableOptions.length ? availableOptions : null,
      qty,
      unitPrice,
      discountType: "none" as const,
      discountValue: 0,
      sortOrder: startSortOrder + index + 1,
      lineSubtotal,
      lineDiscountTotal: 0,
      lineTotal: lineSubtotal,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/** Quote line helpers used in tests to simulate builder edits without React. */
export function removeQuoteLineById(items: QuoteItem[], itemId: string): QuoteItem[] {
  return items.filter((item) => item.id !== itemId);
}

export function updateQuoteLineQty(items: QuoteItem[], itemId: string, qty: number): QuoteItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, qty, updatedAt: new Date().toISOString() } : item));
}

export type QuoteItemDbFields = {
  sku?: string | null;
  sourceProductId?: string | null;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  extraImageUrls?: string[] | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  chosenOptions?: string[] | null;
  availableOptions?: string[] | null;
  importLineId?: string | null;
  discountType?: QuoteItem["discountType"];
  discountValue?: number;
  discountScope?: QuoteItem["discountScope"];
};

export function serializeQuoteItemsForDb(items: QuoteItemDbFields[]) {
  return items.map((item) => {
    const extraImageUrls = (item.extraImageUrls ?? [])
      .map((url) => url.trim())
      .filter(Boolean);
    const availableOptions = (item.availableOptions ?? []).map((option) => option.trim()).filter(Boolean);
    const discountOptions = quoteDiscountFieldsForSave(item);
    const isQuoteDiscount = item.discountScope === "quote";
    const optionsJson =
      item.chosenOptions?.length ||
      availableOptions.length ||
      item.imageUrl ||
      extraImageUrls.length ||
      item.importLineId ||
      isQuoteDiscount
        ? {
            ...(item.chosenOptions?.length ? { chosen_options: item.chosenOptions } : {}),
            ...(availableOptions.length ? { available_options: availableOptions } : {}),
            ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
            ...(extraImageUrls.length ? { extra_image_urls: extraImageUrls } : {}),
            ...(item.importLineId ? { import_line_id: item.importLineId } : {}),
            ...discountOptions,
          }
        : null;
    return {
      product_code: item.sku ?? item.sourceProductId ?? null,
      description: item.name ?? null,
      optional_description: item.description ?? null,
      image_url: item.imageUrl || null,
      qty: Number(item.qty),
      unit_price: isQuoteDiscount ? Number(item.discountValue) || 0 : Number(item.unitPrice),
      amount: Number(item.lineTotal),
      options_json: optionsJson,
    };
  });
}

export function deserializeQuoteItemFromDb(
  item: {
    id?: string;
    productCode?: string | null;
    product_code?: string | null;
    description?: string | null;
    optionalDescription?: string | null;
    optional_description?: string | null;
    imageUrl?: string | null;
    image_url?: string | null;
    qty?: number | string | null;
    unitPrice?: number | string | null;
    unit_price?: number | string | null;
    amount?: number | string | null;
    optionsJson?: {
      chosen_options?: string[];
      available_options?: string[];
      image_url?: string;
      extra_image_urls?: string[];
      import_line_id?: string;
      discount_scope?: "quote";
      discount_type?: "amount" | "percent";
      discount_value?: number;
    } | null;
    options_json?: {
      chosen_options?: string[];
      available_options?: string[];
      image_url?: string;
      extra_image_urls?: string[];
      import_line_id?: string;
      discount_scope?: "quote";
      discount_type?: "amount" | "percent";
      discount_value?: number;
    } | null;
    createdAt?: string;
    updatedAt?: string;
  },
  index: number,
  quoteId: string,
  now: string,
): QuoteItem {
  const qty = Number(item.qty) || 1;
  const storedUnitPrice = Number(item.unitPrice ?? item.unit_price ?? 0) || 0;
  const parsedAmount = Number(item.amount);
  const amount =
    item.amount != null && item.amount !== "" && Number.isFinite(parsedAmount)
      ? parsedAmount
      : round2(qty * storedUnitPrice);
  const productCode = item.productCode ?? item.product_code ?? null;
  const options = item.optionsJson ?? item.options_json ?? null;
  const imageFromDb = (item.imageUrl ?? item.image_url ?? "").trim() || null;
  const imageFromOptions = options?.image_url?.trim() || null;
  const extraImageUrls = normalizeExtraImageUrls(options?.extra_image_urls);
  const availableOptions = (options?.available_options ?? []).map((option) => option.trim()).filter(Boolean);
  const name = item.description ?? productCode ?? "Line Item";
  const description = item.optionalDescription ?? item.optional_description ?? null;
  const discount = quoteDiscountFieldsFromDb({
    options,
    name,
    description,
    sku: productCode,
    unitPrice: storedUnitPrice,
    amount,
  });
  const unitPrice = discount.discountScope === "quote" ? 0 : storedUnitPrice;

  return {
    id: item.id ?? `qi_loaded_${Date.now()}_${index}`,
    quoteId,
    lineType: productCode ? "product" : "custom",
    sourceProductId: productCode,
    sku: productCode,
    importLineId: options?.import_line_id ?? null,
    imageUrl: imageFromDb ?? imageFromOptions,
    extraImageUrls,
    name,
    description,
    chosenOptions: options?.chosen_options ?? null,
    availableOptions: availableOptions.length ? availableOptions : null,
    qty,
    unitPrice,
    discountType: discount.discountType,
    discountValue: discount.discountValue,
    discountScope: discount.discountScope,
    sortOrder: index + 1,
    lineSubtotal: amount,
    lineDiscountTotal: discount.discountScope === "quote" ? Math.abs(amount) : 0,
    lineTotal: amount,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  };
}

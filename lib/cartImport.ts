import type { CartItemRow } from "./extractCartFromPage";
import type { QuoteItem } from "./mockQuote";
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

export function findCartRowForQuoteItem(
  item: Pick<QuoteItem, "importLineId" | "sku" | "sourceProductId" | "unitPrice" | "chosenOptions">,
  cartItems: CartItemRow[],
): CartItemRow | undefined {
  const importLineId = (item.importLineId ?? "").trim();
  if (importLineId) {
    const byStoredId = cartItems.find((row) => (row.cartLineId ?? "").trim() === importLineId);
    if (byStoredId) return byStoredId;
    const byResolved = cartItems.find((row, index) => resolveCartLineId(row, index) === importLineId);
    if (byResolved) return byResolved;
  }

  const sku = (item.sku ?? item.sourceProductId ?? "").trim().toLowerCase();
  const unitPrice = Number(item.unitPrice);
  if (sku && Number.isFinite(unitPrice) && unitPrice > 0) {
    return cartItems.find(
      (row) =>
        (row.productCode ?? "").trim().toLowerCase() === sku &&
        Math.abs((row.unitPrice ?? 0) - unitPrice) < 0.01,
    );
  }

  return undefined;
}

export function collectOptionsForCartLine(
  item: Pick<QuoteItem, "importLineId" | "sku" | "sourceProductId" | "unitPrice" | "chosenOptions">,
  cartItems: CartItemRow[],
): string[] {
  const cartRow = findCartRowForQuoteItem(item, cartItems);
  if (cartRow?.options?.length) {
    return cartRow.options.map((option) => option.trim()).filter(Boolean);
  }
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

export function serializeQuoteItemsForDb(
  items: Array<Pick<QuoteItem, "sku" | "sourceProductId" | "name" | "description" | "imageUrl" | "qty" | "unitPrice" | "lineTotal" | "chosenOptions" | "importLineId">>,
) {
  return items.map((item) => ({
    product_code: item.sku ?? item.sourceProductId ?? null,
    description: item.name ?? null,
    optional_description: item.description ?? null,
    image_url: item.imageUrl || null,
    qty: Number(item.qty),
    unit_price: Number(item.unitPrice),
    amount: Number(item.lineTotal),
    options_json:
      item.chosenOptions?.length || item.imageUrl || item.importLineId
        ? {
            ...(item.chosenOptions?.length ? { chosen_options: item.chosenOptions } : {}),
            ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
            ...(item.importLineId ? { import_line_id: item.importLineId } : {}),
          }
        : null,
  }));
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
    optionsJson?: { chosen_options?: string[]; image_url?: string; import_line_id?: string } | null;
    options_json?: { chosen_options?: string[]; image_url?: string; import_line_id?: string } | null;
  },
  index: number,
  quoteId: string,
  now: string,
): QuoteItem {
  const qty = Number(item.qty) || 1;
  const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0) || 0;
  const amount = Number(item.amount) || round2(qty * unitPrice);
  const productCode = item.productCode ?? item.product_code ?? null;
  const options = item.optionsJson ?? item.options_json ?? null;
  const imageFromDb = (item.imageUrl ?? item.image_url ?? "").trim() || null;
  const imageFromOptions = options?.image_url?.trim() || null;

  return {
    id: item.id ?? `qi_loaded_${Date.now()}_${index}`,
    quoteId,
    lineType: productCode ? "product" : "custom",
    sourceProductId: productCode,
    sku: productCode,
    importLineId: options?.import_line_id ?? null,
    imageUrl: imageFromDb ?? imageFromOptions,
    name: item.description ?? productCode ?? "Line Item",
    description: item.optionalDescription ?? item.optional_description ?? null,
    chosenOptions: options?.chosen_options ?? null,
    qty,
    unitPrice,
    discountType: "none",
    discountValue: 0,
    discountScope: null,
    sortOrder: index + 1,
    lineSubtotal: amount,
    lineDiscountTotal: 0,
    lineTotal: amount,
    createdAt: now,
    updatedAt: now,
  };
}

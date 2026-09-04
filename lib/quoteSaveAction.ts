export type QuoteSaveAction =
  | { mode: "update"; quoteId: string; loadedQuoteNumber: string; currentQuoteNumber: string }
  | {
      mode: "save_as_new";
      originalQuoteId: string;
      loadedQuoteNumber: string;
      currentQuoteNumber: string;
    }
  | { mode: "create"; currentQuoteNumber: string };

export function normalizeQuoteNumber(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Decide insert vs update from loaded quote number vs current form quote number.
 * Does not use the form's database id — only loadedQuoteId + quote number comparison.
 */
export function resolveQuoteSaveAction(params: {
  loadedQuoteId: string | null;
  originalLoadedQuoteNumber: string | null;
  currentQuoteNumber: string;
}): QuoteSaveAction {
  const currentQuoteNumber = normalizeQuoteNumber(params.currentQuoteNumber);
  const loadedQuoteNumber = normalizeQuoteNumber(params.originalLoadedQuoteNumber);

  if (params.loadedQuoteId && loadedQuoteNumber) {
    if (currentQuoteNumber === loadedQuoteNumber) {
      return {
        mode: "update",
        quoteId: params.loadedQuoteId,
        loadedQuoteNumber,
        currentQuoteNumber,
      };
    }

    return {
      mode: "save_as_new",
      originalQuoteId: params.loadedQuoteId,
      loadedQuoteNumber,
      currentQuoteNumber,
    };
  }

  return { mode: "create", currentQuoteNumber };
}

export function mapQuoteItemsForCreate(
  items: Array<{
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
  }>,
) {
  return items.map((item) => {
    const extraImageUrls = (item.extraImageUrls ?? [])
      .map((url) => url.trim())
      .filter(Boolean);
    return {
      product_code: item.sku ?? item.sourceProductId ?? null,
      description: item.name ?? null,
      optional_description: item.description ?? null,
      image_url: item.imageUrl || null,
      qty: Number(item.qty),
      unit_price: Number(item.unitPrice),
      amount: Number(item.lineTotal),
      options_json:
        item.chosenOptions?.length ||
        item.availableOptions?.length ||
        item.imageUrl ||
        extraImageUrls.length ||
        item.importLineId
          ? {
              ...(item.chosenOptions?.length ? { chosen_options: item.chosenOptions } : {}),
              ...(item.availableOptions?.length ? { available_options: item.availableOptions } : {}),
              ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
              ...(extraImageUrls.length ? { extra_image_urls: extraImageUrls } : {}),
              ...(item.importLineId ? { import_line_id: item.importLineId } : {}),
            }
          : null,
    };
  });
}

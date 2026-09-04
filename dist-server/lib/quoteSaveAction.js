"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuoteNumber = normalizeQuoteNumber;
exports.resolveQuoteSaveAction = resolveQuoteSaveAction;
exports.mapQuoteItemsForCreate = mapQuoteItemsForCreate;
function normalizeQuoteNumber(value) {
    return (value ?? "").trim();
}
/**
 * Decide insert vs update from loaded quote number vs current form quote number.
 * Does not use the form's database id — only loadedQuoteId + quote number comparison.
 */
function resolveQuoteSaveAction(params) {
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
function mapQuoteItemsForCreate(items) {
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
            options_json: item.chosenOptions?.length ||
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

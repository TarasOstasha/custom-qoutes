"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuoteNumber = normalizeQuoteNumber;
exports.resolveQuoteSaveAction = resolveQuoteSaveAction;
exports.mapQuoteItemsForCreate = mapQuoteItemsForCreate;
const cartImport_1 = require("./cartImport");
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
    return (0, cartImport_1.serializeQuoteItemsForDb)(items);
}

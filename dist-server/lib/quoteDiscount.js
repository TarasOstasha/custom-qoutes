"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isQuoteDiscountLine = isQuoteDiscountLine;
exports.looksLikeLegacyQuoteDiscountLine = looksLikeLegacyQuoteDiscountLine;
exports.quoteDiscountFieldsForSave = quoteDiscountFieldsForSave;
exports.quoteDiscountFieldsFromDb = quoteDiscountFieldsFromDb;
exports.isShippingLine = isShippingLine;
exports.formatQuoteDiscountRate = formatQuoteDiscountRate;
function asFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
/** Discount line: $ or % applied to merchandise subtotal (not shipping). */
function isQuoteDiscountLine(item) {
    return item.discountScope === "quote";
}
function looksLikeLegacyQuoteDiscountLine(item) {
    const sku = (item.sku ?? item.productCode ?? "").trim();
    if (sku)
        return false;
    const name = (item.name ?? "").trim();
    const description = (item.description ?? "").trim();
    return /^discount$/i.test(name) || /^quote discount$/i.test(description);
}
function quoteDiscountFieldsForSave(item) {
    if (item.discountScope !== "quote")
        return {};
    return {
        discount_scope: "quote",
        discount_type: item.discountType === "percent" ? "percent" : "amount",
        discount_value: Math.max(0, asFiniteNumber(item.discountValue)),
    };
}
function quoteDiscountFieldsFromDb(params) {
    if (params.options?.discount_scope === "quote") {
        return {
            discountType: params.options.discount_type === "percent" ? "percent" : "amount",
            discountValue: Math.max(0, asFiniteNumber(params.options.discount_value)),
            discountScope: "quote",
        };
    }
    if (looksLikeLegacyQuoteDiscountLine({
        name: params.name,
        description: params.description,
        sku: params.sku,
    })) {
        const fromAmount = Math.abs(asFiniteNumber(params.amount));
        const fromPrice = Math.abs(asFiniteNumber(params.unitPrice));
        return {
            discountType: "amount",
            discountValue: fromAmount || fromPrice,
            discountScope: "quote",
        };
    }
    return { discountType: "none", discountValue: 0, discountScope: null };
}
function isShippingLine(item) {
    return item.lineType === "custom" && /^shipping$/i.test(item.name.trim());
}
function formatQuoteDiscountRate(item) {
    if (!isQuoteDiscountLine(item))
        return "";
    if (item.discountType === "percent")
        return `${item.discountValue}%`;
    if (item.discountType === "amount")
        return `$${Math.abs(item.discountValue).toFixed(2)}`;
    return "";
}

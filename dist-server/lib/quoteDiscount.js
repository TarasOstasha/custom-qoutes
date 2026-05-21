"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isQuoteDiscountLine = isQuoteDiscountLine;
exports.isShippingLine = isShippingLine;
exports.formatQuoteDiscountRate = formatQuoteDiscountRate;
/** Discount line: $ or % applied to merchandise subtotal (not shipping). */
function isQuoteDiscountLine(item) {
    return item.discountScope === "quote";
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

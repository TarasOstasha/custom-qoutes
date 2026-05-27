"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taxableBase = taxableBase;
exports.parseTaxRatePercentFromDescription = parseTaxRatePercentFromDescription;
exports.formatTaxRatePercentInput = formatTaxRatePercentInput;
exports.resolveTaxRatePercent = resolveTaxRatePercent;
exports.formatTaxRowLabel = formatTaxRowLabel;
/** Subtotal + shipping (after line discounts) — base for %-driven tax in the quote builder. */
function taxableBase(subtotal, discountTotal, shippingTotal) {
    return Math.round(Math.max(0, subtotal - discountTotal + shippingTotal) * 100) / 100;
}
/** Parse rate from cart label, e.g. `CA Sales Tax (9.5%)` or `CA Sales Tax (9.5)`. */
function parseTaxRatePercentFromDescription(taxDescription) {
    const text = taxDescription?.trim() ?? "";
    if (!text)
        return null;
    const match = text.match(/\(([\d.]+)\s*%?\s*\)/);
    if (!match)
        return null;
    const rate = Number(match[1]);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
}
function formatTaxRatePercentInput(rate) {
    if (rate == null || !Number.isFinite(rate) || rate <= 0)
        return "";
    return String(Number(rate.toFixed(3)));
}
function resolveTaxRatePercent(quote) {
    if (quote.taxRatePercent != null && Number.isFinite(quote.taxRatePercent) && quote.taxRatePercent > 0) {
        return quote.taxRatePercent;
    }
    return parseTaxRatePercentFromDescription(quote.taxDescription);
}
function normalizeStateCode(state) {
    const s = state?.trim().toUpperCase() ?? "";
    return /^[A-Z]{2}$/.test(s) ? s : "";
}
function stateSalesTaxLabel(state) {
    return `${state} Sales Tax`;
}
function taxLabelNeedsStatePrefix(text) {
    if (!text)
        return true;
    if (/^tax$/i.test(text))
        return true;
    if (/^sales tax$/i.test(text))
        return true;
    return false;
}
/** Row heading from cart `.v65-cart-taxtext-cell b` (e.g. "NJ Sales Tax"), or shipping state. */
function formatTaxRowLabel(taxDescription, shippingState) {
    let text = taxDescription?.trim() ? taxDescription.trim().replace(/:\s*$/, "") : "";
    if (text) {
        // Rate is shown in the % field; heading is the jurisdiction name only.
        text = text.replace(/\s*\([^)]*%[^)]*\)\s*$/i, "").trim();
    }
    const state = normalizeStateCode(shippingState);
    if (state && taxLabelNeedsStatePrefix(text)) {
        return stateSalesTaxLabel(state);
    }
    return text || "Tax";
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.round2 = round2;
exports.recalcQuote = recalcQuote;
exports.recalcQuotePreservingTaxRate = recalcQuotePreservingTaxRate;
const quoteDiscount_1 = require("./quoteDiscount");
const taxLabel_1 = require("./taxLabel");
function round2(n) {
    return Math.round(n * 100) / 100;
}
function calcRegularLine(item) {
    const lineSubtotal = round2(item.qty * item.unitPrice);
    let lineDiscountTotal = 0;
    if (item.discountType === "percent") {
        lineDiscountTotal = round2((lineSubtotal * item.discountValue) / 100);
    }
    else if (item.discountType === "amount") {
        lineDiscountTotal = round2(item.discountValue);
    }
    if (lineSubtotal >= 0) {
        lineDiscountTotal = Math.min(lineDiscountTotal, lineSubtotal);
    }
    const net = round2(lineSubtotal - lineDiscountTotal);
    const lineTotal = item.lineType === "custom" ? net : round2(Math.max(0, net));
    return { lineSubtotal, lineDiscountTotal, lineTotal };
}
function calcQuoteDiscountLine(item, merchandiseSubtotal) {
    const lineSubtotal = 0;
    const lineDiscountTotal = item.discountType === "percent"
        ? round2((merchandiseSubtotal * Math.max(0, item.discountValue)) / 100)
        : item.discountType === "amount"
            ? round2(Math.abs(item.discountValue))
            : 0;
    const lineTotal = round2(-lineDiscountTotal);
    return { lineSubtotal, lineDiscountTotal, lineTotal };
}
/** Recompute line totals and quote-level subtotal / discounts / grand total (shipping & tax from overrides). */
function recalcQuote(items, overrides) {
    const regularTotals = new Map();
    for (const item of items) {
        if (!(0, quoteDiscount_1.isQuoteDiscountLine)(item)) {
            regularTotals.set(item.id, calcRegularLine(item));
        }
    }
    const merchandiseSubtotal = round2(items
        .filter((i) => !(0, quoteDiscount_1.isQuoteDiscountLine)(i) && !(0, quoteDiscount_1.isShippingLine)(i))
        .reduce((sum, i) => sum + (regularTotals.get(i.id)?.lineSubtotal ?? 0), 0));
    const mapped = items.map((item) => {
        const totals = (0, quoteDiscount_1.isQuoteDiscountLine)(item)
            ? calcQuoteDiscountLine(item, merchandiseSubtotal)
            : (regularTotals.get(item.id) ?? calcRegularLine(item));
        return { ...item, ...totals };
    });
    const subtotal = round2(mapped.reduce((s, i) => s + i.lineSubtotal, 0));
    const discountTotal = round2(mapped.reduce((s, i) => s + i.lineDiscountTotal, 0));
    const shippingTotal = round2(Number(overrides?.shippingTotal ?? 0));
    const taxTotal = round2(Number(overrides?.taxTotal ?? 0));
    const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);
    return { items: mapped, subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}
/**
 * Recompute line totals; keep a fixed cart/manual tax % when set, otherwise preserve tax $.
 */
function recalcQuotePreservingTaxRate(prev, items, opts) {
    const shippingTotal = round2(opts?.shippingTotal ?? prev.shippingTotal);
    const rate = opts?.taxRatePercent !== undefined
        ? opts.taxRatePercent
        : (0, taxLabel_1.resolveTaxRatePercent)(prev);
    let taxTotal;
    if (opts?.taxTotal !== undefined) {
        taxTotal = round2(opts.taxTotal);
    }
    else if (rate != null && Number.isFinite(rate)) {
        const partial = recalcQuote(items, { shippingTotal, taxTotal: 0 });
        const base = (0, taxLabel_1.taxableBase)(partial.subtotal, partial.discountTotal, shippingTotal);
        taxTotal = base > 0 ? round2((base * rate) / 100) : 0;
    }
    else {
        taxTotal = round2(prev.taxTotal);
    }
    return recalcQuote(items, { shippingTotal, taxTotal });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.round2 = round2;
exports.recalcQuote = recalcQuote;
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** Recompute line totals and quote-level subtotal / discounts / grand total (shipping & tax from overrides). */
function recalcQuote(items, overrides) {
    const mapped = items.map((item) => {
        const lineSubtotal = round2(item.qty * item.unitPrice);
        const lineDiscountTotal = item.discountType === "percent"
            ? round2((lineSubtotal * item.discountValue) / 100)
            : item.discountType === "amount"
                ? round2(item.discountValue)
                : 0;
        const lineTotal = round2(Math.max(0, lineSubtotal - lineDiscountTotal));
        return { ...item, lineSubtotal, lineDiscountTotal, lineTotal };
    });
    const subtotal = round2(mapped.reduce((s, i) => s + i.lineSubtotal, 0));
    const discountTotal = round2(mapped.reduce((s, i) => s + i.lineDiscountTotal, 0));
    const shippingTotal = round2(Number(overrides?.shippingTotal ?? 0));
    const taxTotal = round2(Number(overrides?.taxTotal ?? 0));
    const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);
    return { items: mapped, subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SHIPPING_METHOD = exports.SHIPPING_METHOD_OPTIONS = void 0;
exports.formatShippingMethodLabel = formatShippingMethodLabel;
exports.serializeShippingMethodForDb = serializeShippingMethodForDb;
exports.parseShippingMethodFromDb = parseShippingMethodFromDb;
exports.formatShippingRowAnnotation = formatShippingRowAnnotation;
exports.formatShippingTotalLabel = formatShippingTotalLabel;
const shippingDestination_1 = require("./shippingDestination");
exports.SHIPPING_METHOD_OPTIONS = [
    { value: "0", label: "Please Select" },
    { value: "1", label: "Ground" },
    { value: "2", label: "3 Day" },
    { value: "3", label: "2 Day" },
    { value: "4", label: "Next Day" },
    { value: "5", label: "Over Night" },
    { value: "6", label: "Custom" },
];
exports.DEFAULT_SHIPPING_METHOD = "0";
function formatShippingMethodLabel(value) {
    if (!value || value === exports.DEFAULT_SHIPPING_METHOD)
        return null;
    return exports.SHIPPING_METHOD_OPTIONS.find((option) => option.value === value)?.label ?? null;
}
/** Persist only when the user picked a real method (not "Please Select"). */
function serializeShippingMethodForDb(value) {
    if (!value || value === exports.DEFAULT_SHIPPING_METHOD)
        return null;
    return value;
}
function parseShippingMethodFromDb(value) {
    if (!value)
        return exports.DEFAULT_SHIPPING_METHOD;
    return exports.SHIPPING_METHOD_OPTIONS.some((option) => option.value === value)
        ? value
        : exports.DEFAULT_SHIPPING_METHOD;
}
/** Method and destination suffix for preview / exports (omits "Please Select"). */
function formatShippingRowAnnotation(quote) {
    const parts = [
        formatShippingMethodLabel(quote.shippingMethod),
        (0, shippingDestination_1.formatShippingDestination)(quote.shippingState, quote.shippingZip),
    ].filter((part) => Boolean(part));
    return parts.length > 0 ? parts.join(" · ") : null;
}
/** Left-column shipping label for PDF / Excel totals. */
function formatShippingTotalLabel(quote) {
    const annotation = formatShippingRowAnnotation(quote);
    return annotation ? `Shipping · ${annotation}` : "Shipping";
}

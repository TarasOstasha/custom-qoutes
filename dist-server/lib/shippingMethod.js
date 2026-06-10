"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SHIPPING_METHOD = exports.SHIPPING_METHOD_OPTIONS = void 0;
exports.mergeCartShippingOptions = mergeCartShippingOptions;
exports.buildShippingMethodSelectOptions = buildShippingMethodSelectOptions;
exports.formatShippingMethodLabel = formatShippingMethodLabel;
exports.serializeShippingMethodForDb = serializeShippingMethodForDb;
exports.parseShippingMethodFromDb = parseShippingMethodFromDb;
exports.parseShippingOptionsFromDb = parseShippingOptionsFromDb;
exports.formatShippingRowAnnotation = formatShippingRowAnnotation;
exports.formatShippingTotalLabel = formatShippingTotalLabel;
exports.findCartShippingOption = findCartShippingOption;
exports.resolveShippingMethodFromCartPayload = resolveShippingMethodFromCartPayload;
exports.cartPayloadHasShippingChoice = cartPayloadHasShippingChoice;
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
function mergeCartShippingOptions(existing, incoming) {
    const merged = new Map();
    for (const option of existing ?? []) {
        if (option.value)
            merged.set(option.value, option);
    }
    for (const option of incoming ?? []) {
        if (option.value)
            merged.set(option.value, option);
    }
    return Array.from(merged.values());
}
/** Static builder options plus any cart-imported options (cart values appended). */
function buildShippingMethodSelectOptions(cartOptions) {
    const staticValues = new Set(exports.SHIPPING_METHOD_OPTIONS.map((option) => option.value));
    const staticOptions = exports.SHIPPING_METHOD_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
    }));
    const extra = (cartOptions ?? [])
        .filter((option) => option.value && !staticValues.has(option.value))
        .map((option) => ({ value: option.value, label: option.label }));
    return [...staticOptions, ...extra];
}
function formatShippingMethodLabel(value, cartOptions) {
    if (!value || value === exports.DEFAULT_SHIPPING_METHOD)
        return null;
    const staticLabel = exports.SHIPPING_METHOD_OPTIONS.find((option) => option.value === value)?.label;
    if (staticLabel)
        return staticLabel;
    return cartOptions?.find((option) => option.value === value)?.label ?? null;
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
    return value;
}
function parseShippingOptionsFromDb(value) {
    if (!Array.isArray(value))
        return null;
    const options = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object")
            continue;
        const row = entry;
        const optionValue = String(row.value ?? "").trim();
        const label = String(row.label ?? "").trim();
        if (!optionValue || !label)
            continue;
        const price = Number(row.price);
        const option = { value: optionValue, label };
        if (Number.isFinite(price) && price > 0)
            option.price = price;
        if (row.selected === true)
            option.selected = true;
        options.push(option);
    }
    return options.length ? options : null;
}
/** Method and destination suffix for preview / exports (omits "Please Select"). */
function formatShippingRowAnnotation(quote) {
    const parts = [
        formatShippingMethodLabel(quote.shippingMethod, quote.shippingOptions),
        (0, shippingDestination_1.formatShippingDestination)(quote.shippingState, quote.shippingZip),
    ].filter((part) => Boolean(part));
    return parts.length > 0 ? parts.join(" · ") : null;
}
/** Left-column shipping label for PDF / Excel totals. */
function formatShippingTotalLabel(quote) {
    const annotation = formatShippingRowAnnotation(quote);
    return annotation ? `Shipping · ${annotation}` : "Shipping";
}
function findCartShippingOption(cartOptions, value) {
    if (!value)
        return null;
    return cartOptions?.find((option) => option.value === value) ?? null;
}
/** Default shipping select value after importing a Volusion cart payload. */
function resolveShippingMethodFromCartPayload(payload, fallback = exports.DEFAULT_SHIPPING_METHOD) {
    const candidates = [
        payload.selectedShippingValue?.trim(),
        payload.selectedShippingOption?.value?.trim(),
        payload.shippingOptions?.find((option) => option.selected)?.value?.trim(),
    ];
    for (const candidate of candidates) {
        if (candidate && candidate !== exports.DEFAULT_SHIPPING_METHOD)
            return candidate;
    }
    const realOptions = (payload.shippingOptions ?? []).filter((option) => option.value && option.value !== exports.DEFAULT_SHIPPING_METHOD);
    if (realOptions.length === 1)
        return realOptions[0]?.value ?? fallback;
    return fallback;
}
function cartPayloadHasShippingChoice(payload) {
    return Boolean(payload.selectedShippingValue ||
        payload.selectedShippingOption?.value ||
        payload.shippingOptions?.some((option) => option.selected) ||
        payload.shippingOptions?.some((option) => option.value && option.value !== exports.DEFAULT_SHIPPING_METHOD));
}

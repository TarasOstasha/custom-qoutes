"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SHIPPING_METHOD = exports.SHIPPING_METHOD_OPTIONS = exports.CUSTOM_SHIPPING_METHOD_VALUE = void 0;
exports.mergeCartShippingOptions = mergeCartShippingOptions;
exports.formatShippingOptionDisplayLabel = formatShippingOptionDisplayLabel;
exports.buildShippingMethodSelectOptions = buildShippingMethodSelectOptions;
exports.formatShippingMethodLabel = formatShippingMethodLabel;
exports.serializeShippingMethodForDb = serializeShippingMethodForDb;
exports.parseShippingMethodFromDb = parseShippingMethodFromDb;
exports.parseShippingOptionsFromDb = parseShippingOptionsFromDb;
exports.formatShippingMethodDisplayLabel = formatShippingMethodDisplayLabel;
exports.formatShippingRowAnnotation = formatShippingRowAnnotation;
exports.formatShippingTotalLabel = formatShippingTotalLabel;
exports.findCartShippingOption = findCartShippingOption;
exports.shippingPricesMatch = shippingPricesMatch;
exports.findShippingOptionByPrice = findShippingOptionByPrice;
exports.reconcileShippingSelectionWithTotal = reconcileShippingSelectionWithTotal;
exports.resolveShippingMethodFromShippingOptions = resolveShippingMethodFromShippingOptions;
exports.resolveEffectiveShippingMethod = resolveEffectiveShippingMethod;
exports.resolveShippingMethodFromCartPayload = resolveShippingMethodFromCartPayload;
exports.cartPayloadHasShippingChoice = cartPayloadHasShippingChoice;
/** Manual builder option — always rendered last in the shipping dropdown. */
exports.CUSTOM_SHIPPING_METHOD_VALUE = "6";
/** Static builder options (cart-imported methods are inserted before Custom). */
exports.SHIPPING_METHOD_OPTIONS = [{ value: exports.CUSTOM_SHIPPING_METHOD_VALUE, label: "Custom" }];
/** Unset / please-select sentinel — not shown as a dropdown row when cart supplies options. */
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
/** Compact dropdown label — strips dollar/trailing amounts and the word "Shipping". */
function formatShippingOptionDisplayLabel(label) {
    const trimmed = label.trim();
    if (!trimmed)
        return trimmed;
    const cleaned = trimmed
        .replace(/\$\s*[\d,]+(?:\.\d{2})?/g, "")
        .replace(/[\d,]+\.\d{2}\s*$/, "")
        .replace(/\bshipping\b/gi, "")
        .replace(/\s*[-–—]+\s*/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    return cleaned || trimmed;
}
/** Cart options first, then Custom always last. */
function buildShippingMethodSelectOptions(cartOptions) {
    const staticValues = new Set(exports.SHIPPING_METHOD_OPTIONS.map((option) => option.value));
    const leadingStatic = exports.SHIPPING_METHOD_OPTIONS.filter((option) => option.value !== exports.CUSTOM_SHIPPING_METHOD_VALUE).map((option) => ({ value: option.value, label: option.label }));
    const cart = (cartOptions ?? [])
        .filter((option) => option.value && !staticValues.has(option.value))
        .map((option) => ({ value: option.value, label: option.label }));
    const customOption = exports.SHIPPING_METHOD_OPTIONS.find((option) => option.value === exports.CUSTOM_SHIPPING_METHOD_VALUE);
    const trailingCustom = customOption
        ? [{ value: customOption.value, label: customOption.label }]
        : [];
    return [...leadingStatic, ...cart, ...trailingCustom];
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
/** Compact method name for preview / exports (omits "Please Select", $ amounts, and "Shipping"). */
function formatShippingMethodDisplayLabel(value, cartOptions) {
    const raw = formatShippingMethodLabel(value, cartOptions);
    if (!raw)
        return null;
    const compact = formatShippingOptionDisplayLabel(raw);
    return compact || null;
}
/** Compact shipping method suffix (no destination or amount). */
function formatShippingRowAnnotation(quote) {
    return formatShippingMethodDisplayLabel(quote.shippingMethod, quote.shippingOptions);
}
/** Left-column shipping label for preview / PDF / Excel totals. */
function formatShippingTotalLabel(quote) {
    const method = formatShippingRowAnnotation(quote);
    return method ? `Shipping ${method}` : "Shipping";
}
function findCartShippingOption(cartOptions, value) {
    if (!value)
        return null;
    return cartOptions?.find((option) => option.value === value) ?? null;
}
function shippingPricesMatch(a, b, tolerance = 0.02) {
    const left = Math.round(a * 100) / 100;
    const right = Math.round(b * 100) / 100;
    return Math.abs(left - right) <= tolerance;
}
/** Match the applied cart shipping total to a single dropdown option price. */
function findShippingOptionByPrice(shippingOptions, shippingTotal) {
    if (!shippingOptions?.length || !(shippingTotal > 0))
        return null;
    const matches = shippingOptions.filter((option) => option.price != null &&
        option.price > 0 &&
        shippingPricesMatch(option.price, shippingTotal));
    return matches.length === 1 ? (matches[0] ?? null) : null;
}
function markSelectedShippingOption(shippingOptions, selectedValue) {
    return shippingOptions.map((option) => ({
        ...option,
        selected: Boolean(selectedValue && option.value === selectedValue),
    }));
}
/** Align selected method with the shipping total shown in cart totals when they disagree. */
function reconcileShippingSelectionWithTotal(shippingOptions, shippingTotal, selectedValue) {
    const options = shippingOptions ?? [];
    const byPrice = findShippingOptionByPrice(options, shippingTotal);
    if (byPrice?.value) {
        const current = selectedValue?.trim();
        const currentOption = current ? findCartShippingOption(options, current) : null;
        const currentPrice = currentOption?.price ?? 0;
        const priceMismatch = shippingTotal > 0 &&
            currentPrice > 0 &&
            !shippingPricesMatch(currentPrice, shippingTotal);
        if (!current || priceMismatch || current === exports.DEFAULT_SHIPPING_METHOD) {
            const marked = markSelectedShippingOption(options, byPrice.value);
            return {
                shippingOptions: marked,
                selectedShippingValue: byPrice.value,
                selectedShippingOption: { ...byPrice, selected: true },
            };
        }
    }
    const resolvedValue = selectedValue?.trim() || "";
    const selectedShippingOption = findCartShippingOption(options, resolvedValue) ??
        options.find((option) => option.selected) ??
        null;
    return {
        shippingOptions: resolvedValue
            ? markSelectedShippingOption(options, resolvedValue)
            : options.length
                ? options
                : null,
        selectedShippingValue: resolvedValue,
        selectedShippingOption,
    };
}
/** Pick the cart-marked selection from stored shipping options. */
function resolveShippingMethodFromShippingOptions(shippingOptions, fallback = exports.DEFAULT_SHIPPING_METHOD, shippingTotal) {
    if (shippingTotal != null && shippingTotal > 0) {
        const byPrice = findShippingOptionByPrice(shippingOptions, shippingTotal);
        if (byPrice?.value)
            return byPrice.value;
    }
    const selected = shippingOptions?.find((option) => option.selected)?.value?.trim();
    if (selected && selected !== exports.DEFAULT_SHIPPING_METHOD)
        return selected;
    const realOptions = (shippingOptions ?? []).filter((option) => option.value && option.value !== exports.DEFAULT_SHIPPING_METHOD);
    if (realOptions.length === 1)
        return realOptions[0]?.value ?? fallback;
    return fallback;
}
/** Builder select value — prefers explicit method when it matches total, else price match. */
function resolveEffectiveShippingMethod(quote, fallback = exports.DEFAULT_SHIPPING_METHOD) {
    const method = quote.shippingMethod?.trim();
    if (method && method !== exports.DEFAULT_SHIPPING_METHOD) {
        const option = findCartShippingOption(quote.shippingOptions, method);
        const total = quote.shippingTotal ?? 0;
        if (total > 0 &&
            option?.price != null &&
            option.price > 0 &&
            !shippingPricesMatch(option.price, total)) {
            const byPrice = findShippingOptionByPrice(quote.shippingOptions, total);
            if (byPrice?.value)
                return byPrice.value;
        }
        return method;
    }
    return resolveShippingMethodFromShippingOptions(quote.shippingOptions, fallback, quote.shippingTotal);
}
/** Default shipping select value after importing a Volusion cart payload. */
function resolveShippingMethodFromCartPayload(payload, fallback = exports.DEFAULT_SHIPPING_METHOD) {
    if (payload.shippingTotal != null && payload.shippingTotal > 0) {
        const byPrice = findShippingOptionByPrice(payload.shippingOptions, payload.shippingTotal);
        if (byPrice?.value)
            return byPrice.value;
    }
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

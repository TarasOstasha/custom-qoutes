"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_SHIPPING_OPTION = exports.SHIPPING_CUSTOM_VALUE = void 0;
exports.isPlaceholderShippingOption = isPlaceholderShippingOption;
exports.shippingOptionPrice = shippingOptionPrice;
exports.isScrapedShippingOption = isScrapedShippingOption;
exports.buildShippingDropdownOptions = buildShippingDropdownOptions;
exports.resolveDefaultShippingSelection = resolveDefaultShippingSelection;
exports.normalizeShippingOptions = normalizeShippingOptions;
exports.mergeShippingOptions = mergeShippingOptions;
exports.SHIPPING_CUSTOM_VALUE = "custom";
exports.CUSTOM_SHIPPING_OPTION = {
    label: "Custom",
    value: exports.SHIPPING_CUSTOM_VALUE,
    price: null,
    isCustom: true,
};
function isPlaceholderShippingOption(label) {
    return /^please\s*select/i.test(label) || /^select\s+/i.test(label);
}
function shippingOptionPrice(option) {
    return option.price != null && Number.isFinite(option.price) ? option.price : 0;
}
function isScrapedShippingOption(option) {
    return !option.isCustom && option.value !== exports.SHIPPING_CUSTOM_VALUE;
}
/** Scraped cart options plus a single Custom entry (never duplicated). */
function buildShippingDropdownOptions(options) {
    const scraped = (options ?? []).filter(isScrapedShippingOption);
    return [...scraped, exports.CUSTOM_SHIPPING_OPTION];
}
function resolveDefaultShippingSelection(options, shippingTotal, selectedValue, selectedLabel) {
    const scraped = options.filter(isScrapedShippingOption);
    if (!scraped.length) {
        return shippingTotal > 0 || selectedValue ? exports.SHIPPING_CUSTOM_VALUE : null;
    }
    if (shippingTotal > 0) {
        const byAmount = scraped.find((option) => Math.abs(shippingOptionPrice(option) - shippingTotal) < 0.02);
        if (byAmount)
            return byAmount.value;
    }
    if (selectedValue && selectedValue !== exports.SHIPPING_CUSTOM_VALUE) {
        const byValue = scraped.find((option) => option.value === selectedValue);
        if (byValue)
            return byValue.value;
        if (selectedLabel && !isPlaceholderShippingOption(selectedLabel)) {
            const byLabel = scraped.find((option) => option.label === selectedLabel);
            if (byLabel)
                return byLabel.value;
        }
    }
    const preselected = scraped.find((option) => option.selected);
    if (preselected)
        return preselected.value;
    return scraped[0]?.value ?? exports.SHIPPING_CUSTOM_VALUE;
}
/** Normalize scraped/API payloads (supports legacy `amount` field). */
function normalizeShippingOptions(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((entry) => {
        if (!entry || typeof entry !== "object")
            return null;
        const row = entry;
        const label = String(row.label ?? "").trim();
        const value = String(row.value ?? "").trim();
        if (!label || !value || row.isCustom || value === exports.SHIPPING_CUSTOM_VALUE || value === "0")
            return null;
        const priceRaw = row.price ?? row.amount;
        const price = priceRaw === null || priceRaw === undefined ? null : Number(priceRaw);
        if (price !== null && (!Number.isFinite(price) || price <= 0))
            return null;
        if (isPlaceholderShippingOption(label))
            return null;
        return {
            label,
            value,
            price,
            ...(row.selected ? { selected: true } : {}),
        };
    })
        .filter((option) => option !== null);
}
function mergeShippingOptions(incoming, existing) {
    const normalizedIncoming = normalizeShippingOptions(incoming);
    if (normalizedIncoming.length)
        return normalizedIncoming;
    return normalizeShippingOptions(existing ?? []);
}

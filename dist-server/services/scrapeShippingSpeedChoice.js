"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeShippingSpeedChoiceFromPage = scrapeShippingSpeedChoiceFromPage;
exports.applyShippingSpeedChoiceToPayload = applyShippingSpeedChoiceToPayload;
const extractShippingSpeedChoiceInBrowser_1 = require("../lib/extractShippingSpeedChoiceInBrowser");
function parseShippingLabelPrice(label) {
    const dollarMatches = [...label.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
    const priceToken = dollarMatches.length > 0
        ? dollarMatches[dollarMatches.length - 1]?.[1]
        : label.match(/([\d,]+\.\d{2})\s*$/)?.[1];
    if (!priceToken)
        return 0;
    const price = parseFloat(priceToken.replace(/,/g, ""));
    return Number.isFinite(price) ? price : 0;
}
function parseShippingOptionRows(rows) {
    const shippingOptions = [];
    for (const row of rows) {
        if (!row.value || row.value === "0" || /^please\s*select/i.test(row.label))
            continue;
        const price = parseShippingLabelPrice(row.label);
        if (price <= 0)
            continue;
        shippingOptions.push({ value: row.value, label: row.label, price });
    }
    if (!shippingOptions.length)
        return null;
    let selectedShippingValue = "";
    let shippingTotal = 0;
    const selectedRow = rows.find((row) => row.selected && row.value && row.value !== "0");
    if (selectedRow) {
        const match = shippingOptions.find((option) => option.value === selectedRow.value) ??
            shippingOptions.find((option) => option.label === selectedRow.label);
        if (match) {
            selectedShippingValue = match.value;
            shippingTotal = match.price ?? 0;
        }
    }
    const shippingOptionsMarked = shippingOptions.map((option) => ({
        ...option,
        selected: Boolean(selectedShippingValue && option.value === selectedShippingValue),
    }));
    const selectedShippingOption = shippingOptionsMarked.find((option) => option.selected) ?? null;
    return {
        shippingOptions: shippingOptionsMarked,
        selectedShippingValue,
        selectedShippingOption,
        shippingTotal,
    };
}
/** Read Volusion ShippingSpeedChoice via Playwright locator (no page.evaluate function serialization). */
async function scrapeShippingSpeedChoiceFromPage(page) {
    const select = page.locator(extractShippingSpeedChoiceInBrowser_1.SHIPPING_SPEED_SELECT_SELECTOR).first();
    if ((await select.count()) === 0)
        return null;
    const rows = await select.locator("option").evaluateAll((options) => options.map((option) => {
        const el = option;
        return {
            value: (el.value ?? "").trim(),
            label: (el.label || el.textContent || "").replace(/\s+/g, " ").trim(),
            selected: el.selected,
        };
    }));
    return parseShippingOptionRows(rows);
}
function applyShippingSpeedChoiceToPayload(payload, scrape) {
    payload.shippingOptions = scrape.shippingOptions;
    if (scrape.selectedShippingValue) {
        payload.selectedShippingValue = scrape.selectedShippingValue;
        payload.selectedShippingOption = scrape.selectedShippingOption;
    }
    if (scrape.shippingTotal > 0 && payload.shippingTotal <= 0) {
        payload.shippingTotal = scrape.shippingTotal;
    }
}

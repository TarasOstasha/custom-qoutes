"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShippingDestinationText = parseShippingDestinationText;
exports.formatShippingDestination = formatShippingDestination;
/** Parse Volusion cart shipping TD text like "United States, NJ, 07045". */
function parseShippingDestinationText(text) {
    const raw = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!raw)
        return { state: "", zip: "" };
    const zipMatch = raw.match(/\b(\d{5}(?:-\d{4})?)\b/);
    const zip = zipMatch?.[1] ?? "";
    let rest = raw;
    if (zip)
        rest = rest.replace(zip, "").replace(/[,\s]+$/, "").trim();
    const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
    let state = "";
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        if (/^[A-Za-z]{2}$/.test(parts[i] ?? "")) {
            state = (parts[i] ?? "").toUpperCase();
            break;
        }
    }
    return { state, zip };
}
function formatShippingDestination(state, zip) {
    return [state?.trim(), zip?.trim()].filter(Boolean).join(", ");
}

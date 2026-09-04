"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuoteItemImageUrls = getQuoteItemImageUrls;
exports.normalizeExtraImageUrls = normalizeExtraImageUrls;
/** Primary + extra gallery images for a line item (deduped, non-empty). */
function getQuoteItemImageUrls(item) {
    const urls = [];
    const primary = item.imageUrl?.trim();
    if (primary)
        urls.push(primary);
    for (const raw of item.extraImageUrls ?? []) {
        const url = raw?.trim();
        if (url && !urls.includes(url))
            urls.push(url);
    }
    return urls;
}
function normalizeExtraImageUrls(urls) {
    if (!Array.isArray(urls))
        return null;
    const cleaned = urls
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean);
    return cleaned.length ? [...new Set(cleaned)] : null;
}

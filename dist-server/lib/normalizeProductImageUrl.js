"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProductImageUrl = normalizeProductImageUrl;
/**
 * Volusion / storefront URLs often use `*-0.jpg` for the default photo; `-1` is the preferred image.
 */
function normalizeProductImageUrl(url) {
    if (url == null || url === "")
        return url ?? null;
    return url.replace(/-0(\.(?:jpe?g|png|gif|webp))(?=(?:\?|#|$))/gi, "-1$1");
}

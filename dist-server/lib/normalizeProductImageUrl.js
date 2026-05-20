"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProductImageUrl = normalizeProductImageUrl;
const CANONICAL_STORE_ORIGIN = "https://www.xyzdisplays.com";
/** Hosted Volusion storefront hosts use the same `/v/vspfiles/...` paths on the live domain. */
function rewriteVolusionStoreHost(url) {
    try {
        const parsed = new URL(url);
        if (!/\.volusion\.store$/i.test(parsed.hostname))
            return url;
        const canonical = new URL(CANONICAL_STORE_ORIGIN);
        parsed.protocol = canonical.protocol;
        parsed.hostname = canonical.hostname;
        return parsed.href;
    }
    catch {
        return url;
    }
}
/**
 * Volusion / storefront URLs often use `*-0.jpg` for the default photo; `-1` is the preferred image.
 */
function normalizeProductImageUrl(url) {
    if (url == null || url === "")
        return url ?? null;
    const onCanonicalHost = rewriteVolusionStoreHost(url);
    return onCanonicalHost.replace(/-0(\.(?:jpe?g|png|gif|webp))(?=(?:\?|#|$))/gi, "-1$1");
}

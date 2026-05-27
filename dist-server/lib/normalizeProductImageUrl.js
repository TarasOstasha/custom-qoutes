"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferVariantOneUrl = preferVariantOneUrl;
exports.volusionPhotoUrlCandidates = volusionPhotoUrlCandidates;
exports.resolveVolusionProductImageUrl = resolveVolusionProductImageUrl;
exports.normalizeProductImageUrl = normalizeProductImageUrl;
const CANONICAL_STORE_ORIGIN = "https://www.xyzdisplays.com";
const PHOTO_VARIANT = "1";
const PHOTO_EXTENSIONS = ["jpg", "png"];
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
/** Force Volusion photo slot `-1` (preferred storefront image). */
function preferVariantOneUrl(url) {
    return url.replace(/-\d+(\.(?:jpe?g|png|gif|webp))(?=(?:\?|#|$))/i, `-${PHOTO_VARIANT}$1`);
}
function isVolusionPhotoPath(url) {
    try {
        const parsed = new URL(url);
        return /\/v\/vspfiles\/photos\//i.test(parsed.pathname);
    }
    catch {
        return /\/v\/vspfiles\/photos\//i.test(url);
    }
}
function sanitizeProductCode(productCode) {
    return productCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}
function volusionPhotoUrlCandidates(productCode) {
    const code = sanitizeProductCode(productCode);
    if (!code)
        return [];
    return PHOTO_EXTENSIONS.map((ext) => `${CANONICAL_STORE_ORIGIN}/v/vspfiles/photos/${code}-${PHOTO_VARIANT}.${ext}`);
}
function isStorefrontImageContentType(contentType) {
    const ct = contentType.toLowerCase();
    return ct.startsWith("image/jpeg") || ct.startsWith("image/jpg") || ct.startsWith("image/png");
}
async function photoUrlExists(url) {
    try {
        const response = await fetch(url, { method: "HEAD", redirect: "follow" });
        if (!response.ok)
            return false;
        const ct = response.headers.get("content-type") ?? "";
        if (!ct)
            return true;
        return isStorefrontImageContentType(ct);
    }
    catch {
        return false;
    }
}
/** Resolve a Volusion product photo: variant `-1`, probing jpg then png. */
async function resolveVolusionProductImageUrl(productCode) {
    const candidates = volusionPhotoUrlCandidates(productCode ?? "");
    for (const url of candidates) {
        if (await photoUrlExists(url))
            return url;
    }
    return null;
}
/**
 * Normalize scraped or stored URLs to the canonical host and `-1` photo variant.
 */
function normalizeProductImageUrl(url) {
    if (url == null || url === "")
        return url ?? null;
    const onCanonicalHost = rewriteVolusionStoreHost(url);
    if (!isVolusionPhotoPath(onCanonicalHost)) {
        // Keep non-Volusion assets (e.g. custom multer uploads) untouched.
        return onCanonicalHost;
    }
    return preferVariantOneUrl(onCanonicalHost);
}

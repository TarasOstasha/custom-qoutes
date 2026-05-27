const CANONICAL_STORE_ORIGIN = "https://www.xyzdisplays.com";

const PHOTO_VARIANT = "1";
const PHOTO_EXTENSIONS = ["jpg", "png"] as const;

/** Hosted Volusion storefront hosts use the same `/v/vspfiles/...` paths on the live domain. */
function rewriteVolusionStoreHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/\.volusion\.store$/i.test(parsed.hostname)) return url;
    const canonical = new URL(CANONICAL_STORE_ORIGIN);
    parsed.protocol = canonical.protocol;
    parsed.hostname = canonical.hostname;
    return parsed.href;
  } catch {
    return url;
  }
}

/** Force Volusion photo slot `-1` (preferred storefront image). */
export function preferVariantOneUrl(url: string): string {
  return url.replace(/-\d+(\.(?:jpe?g|png|gif|webp))(?=(?:\?|#|$))/i, `-${PHOTO_VARIANT}$1`);
}

function isVolusionPhotoPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\/v\/vspfiles\/photos\//i.test(parsed.pathname);
  } catch {
    return /\/v\/vspfiles\/photos\//i.test(url);
  }
}

function sanitizeProductCode(productCode: string): string {
  return productCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function volusionPhotoUrlCandidates(productCode: string): string[] {
  const code = sanitizeProductCode(productCode);
  if (!code) return [];
  return PHOTO_EXTENSIONS.map(
    (ext) => `${CANONICAL_STORE_ORIGIN}/v/vspfiles/photos/${code}-${PHOTO_VARIANT}.${ext}`,
  );
}

function isStorefrontImageContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.startsWith("image/jpeg") || ct.startsWith("image/jpg") || ct.startsWith("image/png");
}

async function photoUrlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!response.ok) return false;
    const ct = response.headers.get("content-type") ?? "";
    if (!ct) return true;
    return isStorefrontImageContentType(ct);
  } catch {
    return false;
  }
}

/** Resolve a Volusion product photo: variant `-1`, probing jpg then png. */
export async function resolveVolusionProductImageUrl(
  productCode: string | null | undefined,
): Promise<string | null> {
  const candidates = volusionPhotoUrlCandidates(productCode ?? "");
  for (const url of candidates) {
    if (await photoUrlExists(url)) return url;
  }
  return null;
}

/**
 * Normalize scraped or stored URLs to the canonical host and `-1` photo variant.
 */
export function normalizeProductImageUrl(url: string | null | undefined): string | null {
  if (url == null || url === "") return url ?? null;
  const onCanonicalHost = rewriteVolusionStoreHost(url);
  if (!isVolusionPhotoPath(onCanonicalHost)) {
    // Keep non-Volusion assets (e.g. custom multer uploads) untouched.
    return onCanonicalHost;
  }
  return preferVariantOneUrl(onCanonicalHost);
}

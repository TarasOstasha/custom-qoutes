/**
 * Volusion / storefront URLs often use `*-0.jpg` for the default photo; `-1` is the preferred image.
 */
export function normalizeProductImageUrl(url: string | null | undefined): string | null {
  if (url == null || url === "") return url ?? null;
  return url.replace(/-0(\.(?:jpe?g|png|gif|webp))(?=(?:\?|#|$))/gi, "-1$1");
}

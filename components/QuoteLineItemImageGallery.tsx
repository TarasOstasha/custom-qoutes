import { normalizeProductImageUrl } from "../lib/normalizeProductImageUrl";
import { formatQuoteLineImageCaption } from "../lib/formatQuoteLineDescription";
import type { QuoteItem } from "../lib/mockQuote";

type Props = {
  items: QuoteItem[];
  /** Larger tiles for estimate preview; compact strip for builder */
  variant?: "preview" | "builder";
  /** Builder only: clear image on a line item without removing the product */
  onRemoveImage?: (itemId: string) => void;
};

export function QuoteLineItemImageGallery({ items, variant = "preview", onRemoveImage }: Props) {
  const withImages = items.filter((i) => Boolean(i.imageUrl?.trim()));

  const isPreview = variant === "preview";
  const showRemove = variant === "builder" && Boolean(onRemoveImage);
  // const imgW = isPreview ? 120 : 96;
  // const imgH = isPreview ? 100 : 80;
  const imgW = isPreview ? 220 : 160;
  const imgH = isPreview ? 160 : 120;

  return (
    <div
      style={{
        border: "1px solid #d1d5db",
        minHeight: isPreview ? 160 : 100,
        padding: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
        justifyContent: "flex-start",
        background: "#fafafa",
        boxSizing: "border-box",
      }}
    >
      {withImages.length === 0 ? (
        <div
          style={{
            color: "#6b7280",
            width: "100%",
            textAlign: "center",
            padding: isPreview ? 24 : 16,
            fontSize: 13,
          }}
        >
          Product images
        </div>
      ) : (
        withImages.map((item) => (
          <div key={item.id} style={{ textAlign: "center", maxWidth: imgW + 24 }}>
            {(() => {
              const imageHref = normalizeProductImageUrl(item.imageUrl);
              const fallbackHref = `https://www.xyzdisplays.com/ProductDetails.asp?ProductCode=${encodeURIComponent(item.sku ?? "")}`;
              const href = imageHref ?? fallbackHref;
              return (
            <div style={{ position: "relative", display: "inline-block" }}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              title={formatQuoteLineImageCaption(item) || item.name}
              style={{ display: "inline-block" }}
            >
              <img
                src={normalizeProductImageUrl(item.imageUrl) ?? ""}
                alt=""
                style={{
                  width: imgW,
                  height: imgH,
                  objectFit: "contain",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  background: "#fff",
                  display: "block",
                }}
              />
            </a>
            {showRemove ? (
              <button
                type="button"
                className="quote-image-remove-btn"
                aria-label={`Remove image for ${item.name}`}
                title="Remove image"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRemoveImage?.(item.id);
                }}
              >
                ×
              </button>
            ) : null}
            </div>
              );
            })()}
            {(() => {
              const caption = formatQuoteLineImageCaption(item);
              if (!caption) return null;
              return (
              <div
                className="muted"
                style={{
                  marginTop: 4,
                  fontSize: isPreview ? 12 : 11,
                  lineHeight: 1.3,
                  maxWidth: imgW + 24,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: isPreview ? 4 : 2,
                  WebkitBoxOrient: "vertical",
                }}
                title={caption}
              >
                {caption}
              </div>
              );
            })()}
          </div>
        ))
      )}
    </div>
  );
}

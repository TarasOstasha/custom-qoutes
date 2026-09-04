import { normalizeProductImageUrl } from "../lib/normalizeProductImageUrl";
import { formatQuoteLineImageCaption } from "../lib/formatQuoteLineDescription";
import { getQuoteItemImageUrls } from "../lib/quoteItemImages";
import type { QuoteItem } from "../lib/mockQuote";

type Props = {
  items: QuoteItem[];
  /** Larger tiles for estimate preview; compact strip for builder */
  variant?: "preview" | "builder";
  /** Builder only: clear one image without removing the product */
  onRemoveImage?: (itemId: string, imageUrl: string) => void;
};

export function QuoteLineItemImageGallery({ items, variant = "preview", onRemoveImage }: Props) {
  const tiles = items.flatMap((item) =>
    getQuoteItemImageUrls(item).map((imageUrl, imageIndex) => ({
      item,
      imageUrl,
      key: `${item.id}__${imageIndex}__${imageUrl}`,
    })),
  );

  const isPreview = variant === "preview";
  const showRemove = variant === "builder" && Boolean(onRemoveImage);
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
      {tiles.length === 0 ? (
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
        tiles.map(({ item, imageUrl, key }) => (
          <div key={key} style={{ textAlign: "center", maxWidth: imgW + 24 }}>
            {(() => {
              const imageHref = normalizeProductImageUrl(imageUrl);
              const fallbackHref = `https://www.xyzdisplays.com/ProductDetails.php?ProductCode=${encodeURIComponent(item.sku ?? "")}`;
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
                      src={normalizeProductImageUrl(imageUrl) ?? imageUrl}
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
                        onRemoveImage?.(item.id, imageUrl);
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

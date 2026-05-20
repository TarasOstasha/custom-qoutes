import { normalizeProductImageUrl } from "../lib/normalizeProductImageUrl";
import type { QuoteItem } from "../lib/mockQuote";

type Props = {
  items: QuoteItem[];
  /** Larger tiles for estimate preview; compact strip for builder */
  variant?: "preview" | "builder";
};

export function QuoteLineItemImageGallery({ items, variant = "preview" }: Props) {
  const withImages = items.filter((i) => Boolean(i.imageUrl?.trim()));

  const isPreview = variant === "preview";
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
            <a
              href={`https://www.xyzdisplays.com/ProductDetails.asp?ProductCode=${encodeURIComponent(item.sku ?? "")}`}
              target="_blank"
              rel="noreferrer"
              title={item.name}
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
            {!isPreview ? (
              <div
                className="muted"
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  lineHeight: 1.2,
                  maxWidth: imgW + 24,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={item.name}
              >
                {item.sku || item.name}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

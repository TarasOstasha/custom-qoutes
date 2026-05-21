"use client";

import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import QuoteExportButtons from "../../components/QuoteExportButtons";
import { QuoteLineItemImageGallery } from "../../components/QuoteLineItemImageGallery";
import { createEmptyQuote, type Quote } from "../../lib/mockQuote";
import { normalizeProductImageUrl } from "../../lib/normalizeProductImageUrl";
import { formatQuoteDiscountRate, isQuoteDiscountLine } from "../../lib/quoteDiscount";
import { recalcQuote } from "../../lib/recalcQuote";
import { formatShippingDestination } from "../../lib/shippingDestination";
import { formatTaxRowLabel } from "../../lib/taxLabel";
import { clearQuoteDraft, loadQuoteFromPreviewStorage, saveQuoteDraft } from "../../lib/quotePreviewStorage";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function QuotePreviewPage() {
  const [quote, setQuote] = useState<Quote>(() => createEmptyQuote());

  useLayoutEffect(() => {
    const stored = loadQuoteFromPreviewStorage();
    if (stored) setQuote(stored);
  }, []);

  const removeLine = (itemId: string) => {
    setQuote((prev) => {
      const items = prev.items.filter((i) => i.id !== itemId);
      const next = {
        ...prev,
        ...recalcQuote(items, { shippingTotal: prev.shippingTotal, taxTotal: prev.taxTotal }),
      };
      saveQuoteDraft(next);
      return next;
    });
  };

  return (
    <main className="container">
      <div className="actions">
        <Link className="btn" href="/quote-builder">
          Back to Builder
        </Link>
        <QuoteExportButtons quote={quote} colored />
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload app
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (!window.confirm("Clear all quote data from this browser?")) return;
            clearQuoteDraft();
            setQuote(createEmptyQuote());
          }}
        >
          Clear data
        </button>
      </div>

      <section className="preview-sheet">
        <div
          className="preview-header"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div className="preview-company">
            <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>Estimate</h1>
            <div>xyzDisplays</div>
            <div>170 Cagnesbridge Rd, Bldg A7</div>
            <div>Montville, NJ 07045</div>
            <div>sales@xyzdisplays.com</div>
            <div>Phone: (973) 515-5151</div>
          </div>

          <div style={{ maxWidth: 260, justifySelf: "center", paddingTop: 36 }}>
            <div>{quote.customerName || "—"}</div>
            <div>{quote.customerCompany || ""}</div>
            {quote.customerAddress ? (
              <div style={{ whiteSpace: "pre-line" }}>{quote.customerAddress}</div>
            ) : null}
            <div>{quote.customerEmail || ""}</div>
            {quote.customerPhone ? <div>{quote.customerPhone}</div> : null}
          </div>

          <table className="preview-meta" style={{ width: 210, fontSize: 13 }}>
            <tbody>
              <tr>
                <th style={{ padding: "8px 10px" }}>Quote</th>
                <th style={{ padding: "8px 10px" }}>Date</th>
              </tr>
              <tr>
                <td className="right" style={{ padding: "10px", textAlign: "left" }}>
                  {quote.quoteNumber}
                </td>
                <td className="right" style={{ padding: "10px", textAlign: "left" }}>
                  {quote.quoteDate}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="preview-block">
          <QuoteLineItemImageGallery items={quote.items} variant="preview" />
        </div>

        <div className="preview-block">
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Stock #</th>
                <th>Description</th>
                <th style={{ width: 80 }}>Qty</th>
                <th style={{ width: 110 }}>Unit Price</th>
                <th style={{ width: 110 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: "16px 8px" }}>
                    No line items yet. Add items in the builder, then open Preview again.
                  </td>
                </tr>
              ) : (
                quote.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.sku || "—"}</td>
                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                          {item.imageUrl ? (
                            <img
                              src={normalizeProductImageUrl(item.imageUrl) ?? item.imageUrl}
                              alt=""
                              style={{
                                width: 40,
                                height: 40,
                                objectFit: "cover",
                                borderRadius: 6,
                                border: "1px solid #e5e7eb",
                                flex: "0 0 auto",
                              }}
                            />
                          ) : null}
                          <div style={{ minWidth: 0 }}>
                            <div>
                              {item.sku ? (
                                <a
                                  href={`https://www.xyzdisplays.com/ProductDetails.asp?ProductCode=${encodeURIComponent(item.sku)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: "#111827", textDecoration: "none" }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.color = "#2563eb";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.color = "#111827";
                                  }}
                                >
                                  {item.description || item.name}
                                </a>
                              ) : (
                                item.description || item.name
                              )}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="quote-preview-remove-line"
                          aria-label={`Remove ${item.name}`}
                          title="Remove line"
                          onClick={() => removeLine(item.id)}
                        >
                          ×
                        </button>
                      </div>
                    </td>
                    <td className="right">{isQuoteDiscountLine(item) ? "—" : item.qty}</td>
                    <td className="right">
                      {isQuoteDiscountLine(item) ? formatQuoteDiscountRate(item) : money(item.unitPrice)}
                    </td>
                    <td className="right">{money(item.lineTotal)}</td>
                  </tr>
                ))
              )}
              <tr>
                <td colSpan={4} className="right">
                  Subtotal
                </td>
                <td className="right">{money(quote.subtotal)}</td>
              </tr>
              {quote.discountTotal > 0 ? (
                <tr>
                  <td colSpan={4} className="right">
                    Discounts
                  </td>
                  <td className="right">−{money(quote.discountTotal)}</td>
                </tr>
              ) : null}
              <tr>
                <td colSpan={4} className="right">
                  Shipping
                  {formatShippingDestination(quote.shippingState, quote.shippingZip) ? (
                    <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                      {formatShippingDestination(quote.shippingState, quote.shippingZip)}
                    </span>
                  ) : null}
                </td>
                <td className="right">{quote.shippingLabel?.trim() ? quote.shippingLabel : money(quote.shippingTotal)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="right">
                  {formatTaxRowLabel(quote.taxDescription, quote.shippingState)}
                </td>
                <td className="right">{quote.taxLabel?.trim() ? quote.taxLabel : money(quote.taxTotal)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="right" style={{ fontWeight: 700 }}>
                  TOTAL
                </td>
                <td className="right" style={{ fontWeight: 700 }}>
                  {money(quote.grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="preview-block" style={{ minHeight: 80 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>NOTES:</div>
          <div className="muted">{quote.notes || "—"}</div>
        </div>

        <div className="preview-block muted" style={{ textAlign: "center" }}>
          Estimate Valid For 30 Days
        </div>
      </section>
    </main>
  );
}

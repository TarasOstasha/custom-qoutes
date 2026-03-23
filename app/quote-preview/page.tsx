import Link from "next/link";
import { mockQuote } from "../../lib/mockQuote";

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function QuotePreviewPage() {
  const quote = mockQuote;
  const previewImage = quote.items.find((i) => i.imageUrl)?.imageUrl;

  return (
    <main className="container">
      <div className="actions">
        <Link className="btn" href="/quote-builder">
          Back to Builder
        </Link>
        <button className="btn">Export Excel</button>
      </div>

      <section className="preview-sheet">
        <div className="preview-header">
          <div className="preview-company">
            <h1 style={{ margin: "0 0 6px", fontSize: 22 }}>Estimate</h1>
            <div>xyzDisplays</div>
            <div>170 Cagnesbridge Rd, Bldg A7</div>
            <div>Montville, NJ 07045</div>
            <div>sales@xyzdisplays.com</div>
            <div>Phone: (973) 515-5151</div>
          </div>

          <table className="preview-meta">
            <tbody>
              <tr>
                <th>Quote</th>
                <th>Date</th>
              </tr>
              <tr>
                <td className="right">{quote.quoteNumber}</td>
                <td className="right">{quote.quoteDate}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="preview-block">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>TO</div>
          <div>{quote.customerName}</div>
          <div>{quote.customerCompany}</div>
          <div>{quote.customerEmail}</div>
        </div>

        <div className="preview-block">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>DESCRIPTION:</div>
          {previewImage ? (
            <img src={previewImage} alt="Quoted product preview" className="preview-image" />
          ) : (
            <div className="preview-image" style={{ display: "grid", placeItems: "center", color: "#6b7280" }}>
              Product Image
            </div>
          )}
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
              {quote.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.sku || "-"}</td>
                  <td>
                    <div>{item.name}</div>
                    {item.description ? <div className="muted">{item.description}</div> : null}
                  </td>
                  <td className="right">{item.qty}</td>
                  <td className="right">{money(item.unitPrice)}</td>
                  <td className="right">{money(item.lineTotal)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="right">
                  Subtotal
                </td>
                <td className="right">{money(quote.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="right">
                  Shipping
                </td>
                <td className="right">{money(quote.shippingTotal)}</td>
              </tr>
              <tr>
                <td colSpan={4} className="right">
                  Sales Tax
                </td>
                <td className="right">{quote.taxTotal === 0 ? "N/A" : money(quote.taxTotal)}</td>
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
          <div className="muted">{quote.notes}</div>
        </div>

        <div className="preview-block muted" style={{ textAlign: "center" }}>
          Estimate Valid For 30 Days
        </div>
      </section>
    </main>
  );
}

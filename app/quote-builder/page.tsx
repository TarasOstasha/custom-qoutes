"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { mockQuote, Quote, QuoteItem } from "../../lib/mockQuote";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function recalc(items: QuoteItem[]) {
  const mapped = items.map((item) => {
    const lineSubtotal = round2(item.qty * item.unitPrice);
    const lineDiscountTotal =
      item.discountType === "percent"
        ? round2((lineSubtotal * item.discountValue) / 100)
        : item.discountType === "amount"
          ? round2(item.discountValue)
          : 0;
    const lineTotal = round2(Math.max(0, lineSubtotal - lineDiscountTotal));
    return { ...item, lineSubtotal, lineDiscountTotal, lineTotal };
  });

  const nonShipping = mapped.filter((i) => i.name !== "Shipping");
  const shipping = mapped.filter((i) => i.name === "Shipping");

  const subtotal = round2(nonShipping.reduce((s, i) => s + i.lineSubtotal, 0));
  const discountTotal = round2(nonShipping.reduce((s, i) => s + i.lineDiscountTotal, 0));
  const shippingTotal = round2(shipping.reduce((s, i) => s + i.lineTotal, 0));
  const taxTotal = 0;
  const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);

  return { items: mapped, subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}

export default function QuoteBuilderPage() {
  const [quote, setQuote] = useState<Quote>(mockQuote);
  const mockCart = {
    cartId: "07387C5E1E344F7DB151AE80E9894EE7",
    cartItems: [{ productCode: "ws54360", qty: 5 }],
  };

  const totals = useMemo(() => recalc(quote.items), [quote.items]);

  const updateItem = (index: number, patch: Partial<QuoteItem>) => {
    setQuote((prev) => {
      const items = [...prev.items];
      const current = items[index];
      if (!current) return prev;
      items[index] = { ...current, ...patch } as QuoteItem;
      return { ...prev, ...recalc(items) };
    });
  };

  const addCustomItem = () => {
    const now = new Date().toISOString();
    const newItem: QuoteItem = {
      id: `qi_${Date.now()}`,
      quoteId: quote.id,
      lineType: "custom",
      sourceProductId: null,
      sku: null,
      imageUrl: null,
      name: "Custom Item",
      description: "Editable custom line",
      qty: 1,
      unitPrice: 0,
      discountType: "none",
      discountValue: 0,
      sortOrder: quote.items.length + 1,
      lineSubtotal: 0,
      lineDiscountTotal: 0,
      lineTotal: 0,
      createdAt: now,
      updatedAt: now,
    };

    setQuote((prev) => {
      const items = [...prev.items, newItem];
      return { ...prev, ...recalc(items) };
    });
  };

  const addCartProducts = async () => {
    const codes = mockCart.cartItems.map((i) => i.productCode).join(",");
    console.log(codes, 'codes')
    const response = await fetch(`http://localhost:5000/quotes/cart-products?codes=${encodeURIComponent(codes)}`, {
      // method: "GET",
      // headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return;

    const data = (await response.json()) as { items?: QuoteItem[] };
    const returnedItems = Array.isArray(data.items) ? data.items : [];
    const qtyByCode = new Map(
      mockCart.cartItems.map((i) => [i.productCode.toLowerCase(), Number(i.qty)] as const)
    );
    const now = new Date().toISOString();

    const mappedItems = returnedItems.map((item, index) => {
      const code = (item.sku ?? item.sourceProductId ?? "").toLowerCase();
      const qty = qtyByCode.get(code) ?? item.qty;
      return {
        ...item,
        id: `qi_cart_${Date.now()}_${index}`,
        quoteId: quote.id,
        qty,
        sortOrder: quote.items.length + index + 1,
        createdAt: now,
        updatedAt: now,
      } as QuoteItem;
    });

    setQuote((prev) => {
      const items = [...prev.items, ...mappedItems];
      return { ...prev, ...recalc(items) };
    });
  };

  return (
    <main className="container">
      <div className="card section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 className="title">Quote Builder</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Internal demo UI with mock data.
            </p>
          </div>
          <div className="actions">
            <button className="btn">Add Product</button>
            <button className="btn">Export Excel</button>
            <Link className="btn primary" href="/quote-preview">
              Preview Quote
            </Link>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section grid-4">
          <div>
            <label>Quote #</label>
            <input value={quote.quoteNumber} readOnly />
          </div>
          <div>
            <label>Date</label>
            <input value={quote.quoteDate} readOnly />
          </div>
          <div>
            <label>Status</label>
            <input value={quote.status} readOnly />
          </div>
          <div>
            <label>Version</label>
            <input value={String(quote.version)} readOnly />
          </div>
        </div>

        <div className="section">
          <h2 style={{ marginTop: 0 }}>Customer Info</h2>
          <div className="grid-2">
            <div>
              <label>Name</label>
              <input
                value={quote.customerName ?? ""}
                onChange={(e) => setQuote((prev) => ({ ...prev, customerName: e.target.value }))}
              />
            </div>
            <div>
              <label>Company</label>
              <input
                value={quote.customerCompany ?? ""}
                onChange={(e) => setQuote((prev) => ({ ...prev, customerCompany: e.target.value }))}
              />
            </div>
            <div>
              <label>Email</label>
              <input
                value={quote.customerEmail ?? ""}
                onChange={(e) => setQuote((prev) => ({ ...prev, customerEmail: e.target.value }))}
              />
            </div>
            <div>
              <label>Phone</label>
              <input
                value={quote.customerPhone ?? ""}
                onChange={(e) => setQuote((prev) => ({ ...prev, customerPhone: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="section">
          <h2 style={{ marginTop: 0 }}>Line Items</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Stock #</th>
                <th>Description</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 130 }}>Unit Price</th>
                <th style={{ width: 130 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item, index) => (
                <tr key={item.id}>
                  <td>
                    <input
                      value={item.sku ?? ""}
                      placeholder="Custom"
                      onChange={(e) => updateItem(index, { sku: e.target.value || null })}
                    />
                  </td>
                  <td>
                    <input
                      value={item.name}
                      onChange={(e) => updateItem(index, { name: e.target.value })}
                      style={{ marginBottom: 6 }}
                    />
                    <input
                      value={item.description ?? ""}
                      onChange={(e) => updateItem(index, { description: e.target.value })}
                      placeholder="Optional description"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={item.qty}
                      onChange={(e) => updateItem(index, { qty: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value) })}
                    />
                  </td>
                  <td className="right">{currency(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={addCustomItem}>
              Add Custom Item
            </button>
            <button className="btn" onClick={addCartProducts}>
              Add Cart Products
            </button>
          </div>
        </div>

        <div className="section">
          <div className="totals">
            <div className="totals-row">
              <span>Subtotal</span>
              <span>{currency(totals.subtotal)}</span>
            </div>
            <div className="totals-row">
              <span>Shipping</span>
              <span>{currency(totals.shippingTotal)}</span>
            </div>
            <div className="totals-row">
              <span>Tax</span>
              <span>{currency(totals.taxTotal)}</span>
            </div>
            <div className="totals-row total">
              <span>Total</span>
              <span>{currency(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

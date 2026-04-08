"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiBase } from "../../lib/apiBase";
import { extractCartFromPage, type CartPayload } from "../../lib/extractCartFromPage";
import { QuoteLineItemImageGallery } from "../../components/QuoteLineItemImageGallery";
import { exportQuoteToExcel } from "../../lib/exportQuoteToExcel";
import { exportQuoteToPdf } from "../../lib/exportQuoteToPdf";
import { createEmptyQuote, Quote, QuoteItem } from "../../lib/mockQuote";
import { recalcQuote, round2 } from "../../lib/recalcQuote";
import {
  clearQuoteDraft,
  loadQuoteFromPreviewStorage,
  saveQuoteDraft,
} from "../../lib/quotePreviewStorage";
import AddPopupWindow from "../../components/AddPopupWindow";

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function QuoteBuilderPage() {
  const [quote, setQuote] = useState<Quote>(() => createEmptyQuote());
  const skipNextPersist = useRef(false);

  useLayoutEffect(() => {
    const stored = loadQuoteFromPreviewStorage();
    if (stored) {
      setQuote(stored);
      skipNextPersist.current = true;
    }
  }, []);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    saveQuoteDraft(quote);
  }, [quote]);
  const [identifyLoading, setIdentifyLoading] = useState(false);
  const [identifiedEmail, setIdentifiedEmail] = useState<string | null>(null);
  const [copyCartLoading, setCopyCartLoading] = useState(false);
  const [openCartSessionLoading, setOpenCartSessionLoading] = useState(false);
  const [addVolusionLoading, setAddVolusionLoading] = useState(false);
  const [scrapeCartServerLoading, setScrapeCartServerLoading] = useState(false);
  const [liveSessionUrl, setLiveSessionUrl] = useState<string | null>(null);
  const [lastCartPayload, setLastCartPayload] = useState<CartPayload | null>(null);

  const totals = useMemo(
    () => recalcQuote(quote.items, { shippingTotal: quote.shippingTotal, taxTotal: quote.taxTotal }),
    [quote.items, quote.shippingTotal, quote.taxTotal]
  );

  const applyChargeInput = (field: "shipping" | "tax", rawValue: string) => {
    const trimmed = rawValue.trim();
    const numeric = Number(trimmed.replace(/[$,\s]/g, ""));
    const isNumeric = trimmed.length > 0 && Number.isFinite(numeric);

    setQuote((prev) => {
      const nextShippingTotal = field === "shipping" ? (isNumeric ? round2(numeric) : 0) : prev.shippingTotal;
      const nextTaxTotal = field === "tax" ? (isNumeric ? round2(numeric) : 0) : prev.taxTotal;
      const nextLabel = trimmed.length > 0 && !isNumeric ? trimmed : null;

      const recalculated = recalcQuote(prev.items, {
        shippingTotal: nextShippingTotal,
        taxTotal: nextTaxTotal,
      });

      return {
        ...prev,
        ...recalculated,
        ...(field === "shipping" ? { shippingLabel: nextLabel } : { taxLabel: nextLabel }),
      };
    });
  };

  const updateItem = (index: number, patch: Partial<QuoteItem>) => {
    setQuote((prev) => {
      const items = [...prev.items];
      const current = items[index];
      if (!current) return prev;
      items[index] = { ...current, ...patch } as QuoteItem;
      return {
        ...prev,
        ...recalcQuote(items, { shippingTotal: prev.shippingTotal, taxTotal: prev.taxTotal }),
      };
    });
  };

  const removeLine = (itemId: string) => {
    setQuote((prev) => {
      const items = prev.items.filter((i) => i.id !== itemId);
      return {
        ...prev,
        ...recalcQuote(items, { shippingTotal: prev.shippingTotal, taxTotal: prev.taxTotal }),
      };
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
      return {
        ...prev,
        ...recalcQuote(items, { shippingTotal: prev.shippingTotal, taxTotal: prev.taxTotal }),
      };
    });
  };

  const appendScrapedCartPayload = (payload: CartPayload) => {
    const cartItems = payload.cartItems;
    const now = new Date().toISOString();

    const normalized = new Map<
      string,
      { productCode: string; name: string; qty: number; unitPrice: number; lineTotal: number; imageUrl?: string }
    >();
    for (const row of cartItems) {
      const productCode = (row.productCode ?? "").trim();
      const name = (row.name ?? "").trim();
      if (!productCode && !name) continue;
      if (/^empty my entire cart$/i.test(name)) continue;
      const key = `${productCode.toLowerCase()}|${name.toLowerCase()}`;
      const existing = normalized.get(key);
      if (!existing) {
        normalized.set(key, row);
        continue;
      }

      // Keep the richer/priced row when duplicate lines exist in scraped markup.
      const existingScore = (existing.lineTotal > 0 ? 2 : 0) + (existing.unitPrice > 0 ? 1 : 0);
      const nextScore = (row.lineTotal > 0 ? 2 : 0) + (row.unitPrice > 0 ? 1 : 0);
      if (nextScore > existingScore) {
        normalized.set(key, row);
      } else if (nextScore === existingScore) {
        normalized.set(key, {
          ...existing,
          qty: Math.max(existing.qty, row.qty),
          lineTotal: Math.max(existing.lineTotal, row.lineTotal),
          unitPrice: Math.max(existing.unitPrice, row.unitPrice),
          ...((existing.imageUrl || row.imageUrl)
            ? { imageUrl: existing.imageUrl || row.imageUrl }
            : {}),
        });
      }
    }
    const dedupedRows = Array.from(normalized.values());

    const mappedItems = dedupedRows.map((row, index) => {
      const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 1;
      const unitPrice =
        Number.isFinite(row.unitPrice) && row.unitPrice > 0
          ? row.unitPrice
          : qty > 0 && Number.isFinite(row.lineTotal)
            ? round2(row.lineTotal / qty)
            : 0;
      const lineSubtotal = round2(unitPrice * qty);

      return {
        id: `qi_scrape_${Date.now()}_${index}`,
        quoteId: quote.id,
        lineType: "product",
        sourceProductId: row.productCode || null,
        sku: row.productCode || null,
        imageUrl: row.imageUrl ?? null,
        name: row.name || row.productCode || "Cart Item",
        description: null,
        qty,
        unitPrice,
        discountType: "none",
        discountValue: 0,
        sortOrder: quote.items.length + index + 1,
        lineSubtotal,
        lineDiscountTotal: 0,
        lineTotal: lineSubtotal,
        createdAt: now,
        updatedAt: now,
      } as QuoteItem;
    });

    setQuote((prev) => {
      const items = [...prev.items, ...mappedItems];
      return {
        ...prev,
        ...recalcQuote(items, {
          shippingTotal: payload.shippingTotal ?? 0,
          taxTotal: payload.taxTotal ?? 0,
        }),
      };
    });
  };

  const addVolusionProducts = async (productCodeInput?: string) => {
    const inputCodes = (productCodeInput ?? "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);

    if (!inputCodes.length) {
      alert("Enter at least one product code.");
      return;
    }

    setAddVolusionLoading(true);
    try {
      const codes = inputCodes.join(",");
      const response = await fetch(`${apiBase}/quotes/products?codes=${encodeURIComponent(codes)}`);
      const data = (await response.json()) as { items?: QuoteItem[]; error?: string };

      if (!response.ok) {
        alert(data?.error ?? "Failed to load Volusion products");
        return;
      }

      const returnedItems = Array.isArray(data.items) ? data.items : [];
      if (!returnedItems.length) {
        alert("No Volusion products were found for the provided code(s).");
        return;
      }

      const now = new Date().toISOString();

      setQuote((prev) => {
        const mappedItems = returnedItems.map((item, index) => {
          return {
            ...item,
            id: `qi_volusion_${Date.now()}_${index}`,
            quoteId: prev.id,
            qty: item.qty ?? 1,
            imageUrl: item.imageUrl ?? null,
            sortOrder: prev.items.length + index + 1,
            createdAt: now,
            updatedAt: now,
          } as QuoteItem;
        });

        const items = [...prev.items, ...mappedItems];
        return {
          ...prev,
          ...recalcQuote(items, { shippingTotal: prev.shippingTotal, taxTotal: prev.taxTotal }),
        };
      });
    } finally {
      setAddVolusionLoading(false);
    }
  };

  const copyCart = async () => {
    setCopyCartLoading(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      const payload = extractCartFromPage();
      console.log(payload);
      setLastCartPayload(payload);
      if (!payload.cartItems.length && !payload.shippingTotal && !payload.taxTotal) return;
      appendScrapedCartPayload(payload);
    } finally {
      setCopyCartLoading(false);
    }
  };

  /** Playwright on the API uses a persistent Chromium profile (`VOLUSION_PLAYWRIGHT_USER_DATA_DIR`); no cookies in the request. */
  const openLiveCartSession = async () => {
    setOpenCartSessionLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/cart/open-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as { opened?: boolean; url?: string; error?: string };
      if (!response.ok) {
        alert(data?.error ?? "Failed to open cart session");
        return;
      }
      setLiveSessionUrl(data.url ?? null);
    } finally {
      setOpenCartSessionLoading(false);
    }
  };

  const copyCartViaServer = async () => {
    setScrapeCartServerLoading(true);
    try {
      const response = await fetch(`${apiBase}/quotes/scrape-cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as CartPayload & { error?: string };
      if (!response.ok) {
        alert(data?.error ?? "Scrape cart failed");
        return;
      }
      setLastCartPayload(data);
      if (!data.cartItems?.length && !data.shippingTotal && !data.taxTotal) return;
      appendScrapedCartPayload(data);
    } finally {
      setScrapeCartServerLoading(false);
    }
  };

  const identifyUser = async () => {
    const cartId = lastCartPayload?.cartId?.trim() || "";
    if (!cartId) {
      alert("No cart loaded yet. Use Copy Cart or Add Products From Cart first.");
      return;
    }
    setIdentifyLoading(true);
    setIdentifiedEmail(null);
    try {
      const response = await fetch(`${apiBase}/quotes/identify-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId }),
      });
      const data = (await response.json()) as { cartId?: string; email?: string | null; error?: string };
      if (!response.ok) {
        alert(data?.error ?? "Identify User failed");
        return;
      }
      setIdentifiedEmail(data.email ?? null);
    } finally {
      setIdentifyLoading(false);
    }
  };

  return (
    <main className="container">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes quote-builder-identify-spin {
              to { transform: rotate(360deg); }
            }
            .quote-builder-identify-spinner {
              width: 16px;
              height: 16px;
              border: 2px solid #9ca3af;
              border-top-color: #1d4ed8;
              border-radius: 50%;
              animation: quote-builder-identify-spin 0.65s linear infinite;
              flex-shrink: 0;
            }
          `,
        }}
      />
      <div className="card section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 className="title">Quote Builder</h1>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Internal demo UI with mock data.
            </p>
          </div>
          <div className="actions">
            {/* <button className="btn">Add Product</button> */}
            <button type="button" className="btn" onClick={() => void exportQuoteToExcel(quote)}>
              Export Excel
            </button>
            <button type="button" className="btn" onClick={() => void exportQuoteToPdf(quote)}>
              Export PDF
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!window.confirm("Clear all quote data from this browser?")) return;
                clearQuoteDraft();
                setLastCartPayload(null);
                setQuote(createEmptyQuote());
              }}
            >
              Clear data
            </button>
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
            <input
              value={quote.quoteNumber}
              onChange={(e) => setQuote((prev) => ({ ...prev, quoteNumber: e.target.value }))}
            />
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
          <h2 style={{ marginTop: 0 }}>Product images</h2>
          <QuoteLineItemImageGallery items={quote.items} variant="builder" />
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
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input
                          value={item.name}
                          onChange={(e) => updateItem(index, { name: e.target.value })}
                          style={{ marginBottom: 6, width: "100%" }}
                        />
                        <input
                          value={item.description ?? ""}
                          onChange={(e) => updateItem(index, { description: e.target.value })}
                          placeholder="Optional description"
                          style={{ width: "100%" }}
                        />
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
            {/* <button className="btn" onClick={addVolusionProducts} disabled={addVolusionLoading}>
              {addVolusionLoading ? "Adding Volusion..." : "Add Volusion Products"}
            </button> */}
            <AddPopupWindow onAdd={addVolusionProducts} />
            <span style={{ display: "none", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={identifyUser}
                disabled={identifyLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                {identifyLoading ? (
                  <>
                    <span className="quote-builder-identify-spinner" aria-hidden />
                    <span>Identify User</span>
                  </>
                ) : (
                  "Identify User"
                )}
              </button>
              {identifyLoading ? (
                <span className="muted" style={{ fontWeight: 600 }}>
                  Loading cart data...
                </span>
              ) : null}
            </span>
            <span style={{ display: "none", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={copyCart}
                disabled={copyCartLoading || identifyLoading}
              >
                Copy Cart
              </button>
              {copyCartLoading ? (
                <span className="muted" style={{ fontWeight: 600 }}>
                  Reading cart...
                </span>
              ) : null}
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.45, display: "none" }}>
              Server scrape uses Playwright with a persistent profile only. Set{" "}
              <code style={{ fontSize: 12 }}>VOLUSION_PLAYWRIGHT_USER_DATA_DIR</code> on the API. The scrape runs
              headless from the current persistent session; no cookies are sent in the request body.
            </p>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={openLiveCartSession}
                disabled={openCartSessionLoading || identifyLoading || Boolean(liveSessionUrl)}
                style={{ marginRight: 8 }}
              >
                {openCartSessionLoading
                  ? "Opening cart session…"
                  : liveSessionUrl
                    ? "Session Ready"
                    : "Open Live Website Session"}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={copyCartViaServer}
                disabled={scrapeCartServerLoading || openCartSessionLoading || identifyLoading}
              >
                {scrapeCartServerLoading ? "Reading live cart…" : "Add Products From Cart"}
              </button>
            </div>
            {liveSessionUrl ? (
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Live session page: {liveSessionUrl}
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: 10, fontSize: 14, display: "none" }}>
            Identified Email: {identifiedEmail ?? "Not found"}
          </div>
          {lastCartPayload ? (
            <div style={{ marginTop: 6, fontSize: 12 }} className="muted">
              Last cart: {lastCartPayload.cartId} · {lastCartPayload.cartItems.length} item(s) · tax{" "}
              {currency(lastCartPayload.taxTotal)} · total {currency(lastCartPayload.grandTotal)}
            </div>
          ) : null}
        </div>

        <div className="section" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
          <div>
            <label htmlFor="quote-notes-builder">Notes</label>
            <textarea
              id="quote-notes-builder"
              value={quote.notes ?? ""}
              onChange={(e) => setQuote((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Add internal or customer-facing notes"
              style={{
                marginTop: 8,
                width: "100%",
                minHeight: 108,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "10px 12px",
                font: "inherit",
                resize: "vertical",
                background: "#fff",
              }}
            />
          </div>
          <div className="totals">
            <div className="totals-row">
              <span>Subtotal</span>
              <span>{currency(totals.subtotal)}</span>
            </div>
            <div className="totals-row">
              <span>Shipping</span>
              <input
                value={quote.shippingLabel ?? String(totals.shippingTotal)}
                onChange={(e) => applyChargeInput("shipping", e.target.value)}
                placeholder="e.g. 25 or TBD"
                style={{ maxWidth: 120, textAlign: "right" }}
              />
            </div>
            <div className="totals-row">
              <span>Tax</span>
              <input
                value={quote.taxLabel ?? String(totals.taxTotal)}
                onChange={(e) => applyChargeInput("tax", e.target.value)}
                placeholder="e.g. 0 or TBD"
                style={{ maxWidth: 120, textAlign: "right" }}
              />
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

"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { apiBase } from "../../lib/apiBase";
import { extractCartFromPage, type CartPayload } from "../../lib/extractCartFromPage";
import { QuoteLineItemImageGallery } from "../../components/QuoteLineItemImageGallery";
import QuoteExportButtons from "../../components/QuoteExportButtons";
import { createEmptyQuote, Quote, QuoteItem } from "../../lib/mockQuote";
import { isQuoteDiscountLine } from "../../lib/quoteDiscount";
import { recalcQuote, round2 } from "../../lib/recalcQuote";
import { formatShippingDestination } from "../../lib/shippingDestination";
import { formatTaxRowLabel } from "../../lib/taxLabel";
import {
  clearQuoteDraft,
  loadQuoteFromPreviewStorage,
  saveQuoteDraft,
} from "../../lib/quotePreviewStorage";
import AddPopupWindow from "../../components/AddPopupWindow";

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type LineItemOptionState = {
  loading: boolean;
  expanded: boolean;
  options: string[];
  selected: string[];
  error: string | null;
};

const DESC_SECONDARY_SEPARATOR = " || ";

export default function QuoteBuilderPage() {
  const [quote, setQuote] = useState<Quote>(() => createEmptyQuote());
  const skipNextPersist = useRef(false);
  const customImageInputRef = useRef<HTMLInputElement | null>(null);
  const [customImageTargetId, setCustomImageTargetId] = useState<string | null>(null);

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
  const [lineItemOptions, setLineItemOptions] = useState<Record<string, LineItemOptionState>>({});

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

  /** Implied rate from tax $ ÷ (subtotal + shipping). */
  const derivedTaxRatePercent = useMemo(() => {
    const base = round2(Math.max(0, totals.subtotal - totals.discountTotal + totals.shippingTotal));
    if (base <= 0) return "";
    const pct = (quote.taxTotal / base) * 100;
    if (!Number.isFinite(pct) || pct <= 0) return "";
    return pct.toFixed(2);
  }, [totals.subtotal, totals.discountTotal, totals.shippingTotal, quote.taxTotal]);

  /**
   * Draft string while the % field is focused. Without this, the value is re-derived from tax $
   * on every keystroke, so typing "10" collapses to "1.00" after the first digit.
   */
  const [taxPercentDraft, setTaxPercentDraft] = useState<string | null>(null);
  const taxPercentDisplay = taxPercentDraft !== null ? taxPercentDraft : derivedTaxRatePercent;

  const applyTaxPercentFromString = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setQuote((prev) => {
        const recalculated = recalcQuote(prev.items, {
          shippingTotal: prev.shippingTotal,
          taxTotal: 0,
        });
        return { ...prev, ...recalculated, taxLabel: null };
      });
      return;
    }
    const numeric = Number(trimmed.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(numeric)) return;

    setQuote((prev) => {
      const base = round2(Math.max(0, prev.subtotal - prev.discountTotal + prev.shippingTotal));
      const nextTaxTotal = base > 0 ? round2((base * numeric) / 100) : 0;
      const recalculated = recalcQuote(prev.items, {
        shippingTotal: prev.shippingTotal,
        taxTotal: nextTaxTotal,
      });
      return {
        ...prev,
        ...recalculated,
        taxLabel: null,
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
    setLineItemOptions((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const normalizeForMatch = (value: string): string => value.trim().toLowerCase();

  const collectAvailableOptionsForItem = (item: QuoteItem): string[] => {
    const payloadItems = lastCartPayload?.cartItems ?? [];
    if (!payloadItems.length) return [];
    const sku = normalizeForMatch(item.sku ?? "");
    const name = normalizeForMatch(item.name ?? "");

    const matches = payloadItems.filter((row) => {
      const rowCode = normalizeForMatch(row.productCode ?? "");
      const rowName = normalizeForMatch(row.name ?? "");
      const skuMatch = Boolean(sku) && rowCode === sku;
      const nameMatch = Boolean(name) && rowName === name;
      return skuMatch || nameMatch;
    });

    const unique = new Set<string>();
    matches.forEach((row) => {
      (row.options ?? []).forEach((opt) => {
        const normalized = opt.trim();
        if (normalized) unique.add(normalized);
      });
    });
    return Array.from(unique);
  };

  const getLineOptions = (item: QuoteItem) => {
    setLineItemOptions((prev) => ({
      ...prev,
      [item.id]: {
        loading: true,
        expanded: true,
        options: prev[item.id]?.options ?? [],
        selected: prev[item.id]?.selected ?? item.chosenOptions ?? [],
        error: null,
      },
    }));

    const options = collectAvailableOptionsForItem(item);
    setLineItemOptions((prev) => ({
      ...prev,
      [item.id]: {
        loading: false,
        expanded: true,
        options,
        selected: prev[item.id]?.selected ?? item.chosenOptions ?? [],
        error: options.length ? null : "No options found for this line item in the last cart scrape.",
      },
    }));
  };

  const toggleLineOptions = (itemId: string) => {
    setLineItemOptions((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      return {
        ...prev,
        [itemId]: {
          ...current,
          expanded: !current.expanded,
        },
      };
    });
  };

  const toggleOptionSelection = (index: number, itemId: string, option: string) => {
    setLineItemOptions((prev) => {
      const current = prev[itemId];
      if (!current) return prev;
      const alreadySelected = current.selected.includes(option);
      const selected = alreadySelected
        ? current.selected.filter((entry) => entry !== option)
        : [...current.selected, option];

      setQuote((q) => {
        const items = [...q.items];
        if (items[index]?.id !== itemId) return q;
        items[index] = {
          ...items[index],
          chosenOptions: selected.length ? [...selected] : null,
          updatedAt: new Date().toISOString(),
        };
        return {
          ...q,
          ...recalcQuote(items, { shippingTotal: q.shippingTotal, taxTotal: q.taxTotal }),
        };
      });

      return {
        ...prev,
        [itemId]: {
          ...current,
          selected,
        },
      };
    });
  };

  const clearSelectedOptions = (index: number, itemId: string) => {
    setLineItemOptions((prev) => ({
      ...prev,
      [itemId]: {
        loading: false,
        expanded: true,
        options: prev[itemId]?.options ?? [],
        selected: [],
        error: prev[itemId]?.error ?? null,
      },
    }));
    updateItem(index, { chosenOptions: null });
  };

  const splitDescriptionFields = (description: string | null | undefined): { primary: string; secondary: string } => {
    const raw = String(description ?? "");
    const idx = raw.indexOf(DESC_SECONDARY_SEPARATOR);
    if (idx < 0) return { primary: raw, secondary: "" };
    return {
      primary: raw.slice(0, idx),
      secondary: raw.slice(idx + DESC_SECONDARY_SEPARATOR.length),
    };
  };

  const mergeDescriptionFields = (primary: string, secondary: string): string => {
    const p = primary.trim();
    const s = secondary.trim();
    if (p && s) return `${p}${DESC_SECONDARY_SEPARATOR}${s}`;
    return p || s;
  };

  const updateDescriptionField = (index: number, item: QuoteItem, field: "primary" | "secondary", value: string) => {
    const current = splitDescriptionFields(item.description ?? "");
    const nextPrimary = field === "primary" ? value : current.primary;
    const nextSecondary = field === "secondary" ? value : current.secondary;
    updateItem(index, { description: mergeDescriptionFields(nextPrimary, nextSecondary) || null });
  };

  const applySelectedOptionsToDescription = (index: number, item: QuoteItem) => {
    const selected = lineItemOptions[item.id]?.selected ?? [];
    if (!selected.length) return;
    const primary = selected[0] ?? "";
    const secondary = selected.length > 1 ? selected.slice(1).join(" | ") : "";
    updateItem(index, {
      description: mergeDescriptionFields(primary, secondary) || null,
      chosenOptions: null,
    });
    setLineItemOptions((prev) => {
      const current = prev[item.id];
      if (!current) return prev;
      return {
        ...prev,
        [item.id]: {
          ...current,
          expanded: false,
          selected: [],
        },
      };
    });
  };

  const openCustomImagePicker = (itemId: string) => {
    setCustomImageTargetId(itemId);
    customImageInputRef.current?.click();
  };

  const handleCustomImageSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const targetId = customImageTargetId;
    event.target.value = "";
    if (!file || !targetId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setQuote((prev) => {
        const index = prev.items.findIndex((i) => i.id === targetId);
        if (index < 0) return prev;
        const items = [...prev.items];
        items[index] = { ...items[index], imageUrl: result, updatedAt: new Date().toISOString() } as QuoteItem;
        return {
          ...prev,
          ...recalcQuote(items, { shippingTotal: prev.shippingTotal, taxTotal: prev.taxTotal }),
        };
      });
      setCustomImageTargetId(null);
    };
    reader.readAsDataURL(file);
  };

  const appendCustomLine = (preset: "item" | "discount" = "item") => {
    const now = new Date().toISOString();
    const isDiscount = preset === "discount";
    const newItem: QuoteItem = {
      id: `qi_${Date.now()}`,
      quoteId: quote.id,
      lineType: "custom",
      sourceProductId: null,
      sku: null,
      imageUrl: null,
      name: isDiscount ? "Discount" : "Custom Item",
      description: isDiscount ? "Quote discount" : "Editable custom line",
      qty: 1,
      unitPrice: 0,
      discountType: isDiscount ? "amount" : "none",
      discountValue: 0,
      discountScope: isDiscount ? "quote" : null,
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

  const addCustomItem = () => appendCustomLine("item");
  const addDiscountLine = () => appendCustomLine("discount");

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
        shippingState: payload.shippingState?.trim() || prev.shippingState || null,
        shippingZip: payload.shippingZip?.trim() || prev.shippingZip || null,
        taxDescription: payload.taxDescription?.trim() || prev.taxDescription || null,
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
      const payload = await extractCartFromPage();
      console.log(payload);
      setLastCartPayload(payload);
      if (
        !payload.cartItems.length &&
        !payload.shippingTotal &&
        !payload.taxTotal &&
        !payload.shippingState &&
        !payload.shippingZip
      ) {
        return;
      }
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
      if (
        !data.cartItems?.length &&
        !data.shippingTotal &&
        !data.taxTotal &&
        !data.shippingState &&
        !data.shippingZip
      ) {
        return;
      }
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
              Internal UI with mock data.
            </p>
          </div>
          <div className="actions">
            {/* <button className="btn">Add Product</button> */}
            {/* <QuoteExportButtons quote={quote} /> */}
            <QuoteExportButtons quote={quote} colored />
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
            <div style={{ gridColumn: "1 / -1" }}>
              <label>Address</label>
              <textarea
                value={quote.customerAddress ?? ""}
                onChange={(e) => setQuote((prev) => ({ ...prev, customerAddress: e.target.value }))}
                placeholder="Street, city, state, zip"
                style={{
                  marginTop: 8,
                  width: "100%",
                  minHeight: 72,
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  padding: "10px 12px",
                  font: "inherit",
                  resize: "vertical",
                  background: "#fff",
                }}
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
                <Fragment key={item.id}>
                <tr>
                  <td>
                    <input
                      value={item.sku ?? ""}
                      placeholder="Custom"
                      onChange={(e) => updateItem(index, { sku: e.target.value || null })}
                    />
                    {item.lineType !== "custom" ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ marginTop: 8, width: "100%", padding: "6px 10px" }}
                        onClick={() => {
                          const optionState = lineItemOptions[item.id];
                          if (optionState?.expanded) {
                            toggleLineOptions(item.id);
                            return;
                          }
                          getLineOptions(item);
                        }}
                        disabled={!lastCartPayload || !lastCartPayload.cartItems.length}
                      >
                        {lineItemOptions[item.id]?.loading
                          ? "Loading..."
                          : lineItemOptions[item.id]?.expanded
                            ? "Hide Options"
                            : "Get Options"}
                      </button>
                    ) : null}
                    {item.lineType === "custom" && !isQuoteDiscountLine(item) ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ marginTop: 8, width: "100%", padding: "6px 10px" }}
                        onClick={() => openCustomImagePicker(item.id)}
                      >
                        {item.imageUrl ? "Change Img" : "Add Img"}
                      </button>
                    ) : null}
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
                        {(() => {
                          const descFields = splitDescriptionFields(item.description ?? "");
                          return (
                            <>
                              <input
                                value={descFields.primary}
                                onChange={(e) => updateDescriptionField(index, item, "primary", e.target.value)}
                                placeholder="Optional description"
                                style={{ width: "100%" }}
                              />
                              {descFields.secondary ? (
                                <input
                                  value={descFields.secondary}
                                  onChange={(e) => updateDescriptionField(index, item, "secondary", e.target.value)}
                                  placeholder="Additional option details"
                                  style={{ width: "100%", marginTop: 6 }}
                                />
                              ) : null}
                            </>
                          );
                        })()}
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
                  {isQuoteDiscountLine(item) ? (
                    <>
                      <td>
                        <select
                          value={item.discountType === "percent" ? "percent" : "amount"}
                          onChange={(e) =>
                            updateItem(index, {
                              discountType: e.target.value === "percent" ? "percent" : "amount",
                            })
                          }
                          style={{ width: "100%" }}
                        >
                          <option value="amount">$ Amount</option>
                          <option value="percent">% Off</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={item.discountType === "percent" ? "0.01" : "any"}
                          value={item.discountValue}
                          placeholder={item.discountType === "percent" ? "e.g. 10" : "e.g. 50"}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            updateItem(index, { discountValue: Number.isFinite(n) ? Math.max(0, n) : 0 });
                          }}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>
                        <input
                          type="number"
                          step={item.lineType === "custom" ? "any" : 1}
                          min={item.lineType === "custom" ? undefined : 1}
                          value={item.qty}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            updateItem(index, { qty: Number.isFinite(n) ? n : 0 });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step={item.lineType === "custom" ? "any" : undefined}
                          min={item.lineType === "custom" ? undefined : 0}
                          value={item.unitPrice}
                          placeholder={item.lineType === "custom" ? "e.g. -50 for credit" : undefined}
                          title={
                            item.lineType === "custom"
                              ? "Negative unit price or qty reduces the quote total (credit line)"
                              : undefined
                          }
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            updateItem(index, { unitPrice: Number.isFinite(n) ? n : 0 });
                          }}
                        />
                      </td>
                    </>
                  )}
                  <td className="right">{currency(item.lineTotal)}</td>
                </tr>
                {item.lineType !== "custom" && lineItemOptions[item.id]?.expanded ? (
                  <tr>
                    <td colSpan={5} style={{ background: "#f8fafc", borderTop: "none", padding: 10 }}>
                      <div
                        style={{
                          border: "1px solid #d1d5db",
                          borderRadius: 6,
                          padding: 10,
                          background: "#fff",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Options</div>
                        {lineItemOptions[item.id]?.error ? (
                          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                            {lineItemOptions[item.id]?.error}
                          </div>
                        ) : null}
                        <div
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: 6,
                            overflow: "hidden",
                            textAlign: "left",
                          }}
                        >
                        {(lineItemOptions[item.id]?.options ?? []).map((option, optionIndex) => {
                          const checkboxId = `opt_${item.id}_${option}`;
                          return (
                            <label
                              key={option}
                              htmlFor={checkboxId}
                              style={{
                                display: "grid",
                                gridTemplateColumns: "28px 1fr",
                                alignItems: "start",
                                gap: 6,
                                padding: "7px 10px",
                                background: optionIndex % 2 === 0 ? "#ffffff" : "#f8fafc",
                                borderBottom:
                                  optionIndex === (lineItemOptions[item.id]?.options?.length ?? 1) - 1
                                    ? "none"
                                    : "1px solid #edf2f7",
                                fontSize: 13,
                              }}
                            >
                              <input
                                id={checkboxId}
                                type="checkbox"
                                checked={(lineItemOptions[item.id]?.selected ?? []).includes(option)}
                                onChange={() => toggleOptionSelection(index, item.id, option)}
                                style={{ marginTop: 2, justifySelf: "center" }}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => applySelectedOptionsToDescription(index, item)}
                            disabled={(lineItemOptions[item.id]?.selected?.length ?? 0) === 0}
                          >
                            Apply Selected
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "4px 8px", fontSize: 12 }}
                            onClick={() => clearSelectedOptions(index, item.id)}
                            disabled={(lineItemOptions[item.id]?.selected?.length ?? 0) === 0}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>

          <div className="actions" style={{ marginTop: 12 }}>
            <input
              ref={customImageInputRef}
              type="file"
              accept="image/*"
              onChange={handleCustomImageSelected}
              style={{ display: "none" }}
            />
            <button className="btn" onClick={addCustomItem}>
              Add Custom Item
            </button>
            <button className="btn" type="button" onClick={addDiscountLine}>
              Add Discount
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
              Last cart: {lastCartPayload.cartId} · {lastCartPayload.cartItems.length} item(s) · ship{" "}
              {currency(lastCartPayload.shippingTotal)}
              {lastCartPayload.shippingState || lastCartPayload.shippingZip
                ? ` · ${[lastCartPayload.shippingState, lastCartPayload.shippingZip].filter(Boolean).join(", ")}`
                : ""}{" "}
              · tax {currency(lastCartPayload.taxTotal)}
              {lastCartPayload.taxDescription ? ` (${lastCartPayload.taxDescription})` : ""} · total{" "}
              {currency(lastCartPayload.grandTotal)}
            </div>
          ) : null}
        </div>

        <div
          className="section"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 420px",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={{ maxWidth: 480, minWidth: 0 }}>
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
            <div className="totals-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                Shipping
                {formatShippingDestination(quote.shippingState, quote.shippingZip) ? (
                  <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                    {formatShippingDestination(quote.shippingState, quote.shippingZip)}
                  </span>
                ) : null}
              </span>
              <input
                value={quote.shippingLabel ?? String(totals.shippingTotal)}
                onChange={(e) => applyChargeInput("shipping", e.target.value)}
                placeholder="e.g. 72.36 or TBD"
                style={{ maxWidth: 120, textAlign: "right" }}
              />
            </div>
            <div className="totals-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                {formatTaxRowLabel(quote.taxDescription, quote.shippingState)}
              </span>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={taxPercentDisplay}
                    onFocus={() => setTaxPercentDraft(derivedTaxRatePercent)}
                    onBlur={() => setTaxPercentDraft(null)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTaxPercentDraft(v);
                      applyTaxPercentFromString(v);
                    }}
                    placeholder="%"
                    aria-label="Tax percent"
                    style={{ width: 88, minWidth: 88, textAlign: "right" }}
                  />
                  <span className="muted" style={{ fontSize: 13 }}>
                    %
                  </span>
                </div>
                <input
                  value={quote.taxLabel ?? String(totals.taxTotal)}
                  onChange={(e) => applyChargeInput("tax", e.target.value)}
                  placeholder="e.g. 0 or TBD"
                  style={{ maxWidth: 120, textAlign: "right" }}
                />
              </div>
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

"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { apiBase } from "../../lib/apiBase";
import { extractCartFromPage, type CartPayload } from "../../lib/extractCartFromPage";
import { QuoteLineItemImageGallery } from "../../components/QuoteLineItemImageGallery";
import QuoteExportButtons from "../../components/QuoteExportButtons";
import { createEmptyQuote, Quote, QuoteItem } from "../../lib/mockQuote";
import { isQuoteDiscountLine } from "../../lib/quoteDiscount";
import { recalcQuote, recalcQuotePreservingTaxRate, round2 } from "../../lib/recalcQuote";
import {
  formatShippingDestination,
  parseShippingDestinationText,
} from "../../lib/shippingDestination";
import {
  buildShippingMethodSelectOptions,
  formatShippingOptionDisplayLabel,
  cartPayloadHasShippingChoice,
  DEFAULT_SHIPPING_METHOD,
  findCartShippingOption,
  mergeCartShippingOptions,
  parseShippingMethodFromDb,
  parseShippingOptionsFromDb,
  resolveEffectiveShippingMethod,
  resolveShippingMethodFromCartPayload,
  resolveShippingMethodFromShippingOptions,
  reconcileShippingSelectionWithTotal,
  serializeShippingMethodForDb,
} from "../../lib/shippingMethod";
import {
  formatTaxRatePercentInput,
  formatTaxRowLabel,
  isTbdLabel,
  quoteGrandTotalIsTbd,
  parseTaxRatePercentFromDescription,
  resolveTaxRatePercent,
} from "../../lib/taxLabel";
import {
  clearQuoteDraft,
  loadQuoteFromPreviewStorage,
  saveQuoteDraft,
} from "../../lib/quotePreviewStorage";
import AddPopupWindow from "../../components/AddPopupWindow";

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function todayQuoteDate(): string {
  return new Date().toLocaleDateString("en-US");
}

/** `quoteDate` is stored as en-US (e.g. `5/21/2026`); `<input type="date">` needs `YYYY-MM-DD`. */
function quoteDateToInputValue(quoteDate: string): string {
  const trimmed = quoteDate.trim();
  const parsed = new Date(trimmed || todayQuoteDate());
  if (Number.isNaN(parsed.getTime())) return "";
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function inputValueToQuoteDate(iso: string): string {
  if (!iso) return todayQuoteDate();
  const [y, m, d] = iso.split("-").map((v) => Number(v));
  if (!y || !m || !d) return todayQuoteDate();
  return new Date(y, m - 1, d).toLocaleDateString("en-US");
}

type LineItemOptionState = {
  loading: boolean;
  expanded: boolean;
  options: string[];
  selected: string[];
  error: string | null;
};

const DESC_SECONDARY_SEPARATOR = " || ";
type QuoteSearchResult = {
  id: string;
  quoteNumber: string;
  quoteDate: string | null;
  customerName: string | null;
  company: string | null;
  email: string | null;
  total: string | number | null;
  status: string;
};

type ApiQuoteItem = {
  id: string;
  quoteId: string;
  productCode: string | null;
  product_code?: string | null;
  description: string | null;
  optionalDescription: string | null;
  optional_description?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  qty: number | string | null;
  unitPrice: number | string | null;
  unit_price?: number | string | null;
  amount: number | string | null;
  optionsJson?: { chosen_options?: string[]; image_url?: string } | null;
  options_json?: { chosen_options?: string[]; image_url?: string } | null;
  createdAt?: string;
  updatedAt?: string;
};

type ApiQuote = {
  id: string;
  quoteNumber: string;
  quoteDate: string | null;
  status: string;
  version: number;
  customerName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  subtotal: number | string | null;
  shipping: number | string | null;
  shippingLabel?: string | null;
  shippingMethod?: string | null;
  shippingOptionsJson?: unknown;
  shipping_options_json?: unknown;
  shippingState?: string | null;
  shippingZip?: string | null;
  taxRate: number | string | null;
  taxAmount: number | string | null;
  taxLabel?: string | null;
  taxDescription?: string | null;
  total: number | string | null;
  items?: ApiQuoteItem[];
};

const asNumber = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function cartPayloadHasImportableData(payload: CartPayload): boolean {
  return Boolean(
    payload.cartItems.length ||
      payload.shippingTotal ||
      payload.taxTotal ||
      payload.shippingState ||
      payload.shippingZip
  );
}
const dbQuoteIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function QuoteBuilderPage() {
  const [quote, setQuote] = useState<Quote>(() => createEmptyQuote());
  const [loadedQuoteId, setLoadedQuoteId] = useState<string | null>(null);
  const skipNextPersist = useRef(false);
  const customImageInputRef = useRef<HTMLInputElement | null>(null);
  const [customImageTargetId, setCustomImageTargetId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stored = loadQuoteFromPreviewStorage();
    if (stored) {
      setQuote({
        ...stored,
        shippingMethod: resolveEffectiveShippingMethod(stored),
        shippingOptions: stored.shippingOptions?.length
          ? reconcileShippingSelectionWithTotal(
              stored.shippingOptions,
              stored.shippingTotal,
              stored.shippingMethod,
            ).shippingOptions ?? stored.shippingOptions
          : stored.shippingOptions ?? null,
      });
      setLoadedQuoteId(dbQuoteIdPattern.test(stored.id) ? stored.id : null);
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
  const [openLiveCartLoading, setOpenLiveCartLoading] = useState(false);
  const [addVolusionLoading, setAddVolusionLoading] = useState(false);
  const [scrapeCartServerLoading, setScrapeCartServerLoading] = useState(false);
  const [clearCartLoading, setClearCartLoading] = useState(false);
  const [clearCartMessage, setClearCartMessage] = useState<string | null>(null);
  const [clearCartError, setClearCartError] = useState<string | null>(null);
  const [saveQuoteLoading, setSaveQuoteLoading] = useState(false);
  const [saveQuoteSuccess, setSaveQuoteSuccess] = useState<string | null>(null);
  const [saveQuoteError, setSaveQuoteError] = useState<string | null>(null);
  const [persistenceAvailable, setPersistenceAvailable] = useState<boolean | null>(null);
  const [persistenceRetryLoading, setPersistenceRetryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<QuoteSearchResult[]>([]);
  const [loadQuoteLoadingId, setLoadQuoteLoadingId] = useState<string | null>(null);
  const [liveSessionUrl, setLiveSessionUrl] = useState<string | null>(null);
  const [lastCartPayload, setLastCartPayload] = useState<CartPayload | null>(null);
  const [lineItemOptions, setLineItemOptions] = useState<Record<string, LineItemOptionState>>({});

  const totals = useMemo(
    () => recalcQuote(quote.items, { shippingTotal: quote.shippingTotal, taxTotal: quote.taxTotal }),
    [quote.items, quote.shippingTotal, quote.taxTotal]
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const loadPersistenceStatus = async (force = false) => {
      try {
        const query = force ? "?force=1" : "";
        const response = await fetch(`${apiBase}/health${query}`);
        if (!response.ok) return null;
        const data = (await response.json()) as { persistenceAvailable?: boolean };
        const available = Boolean(data.persistenceAvailable);
        if (!cancelled) {
          setPersistenceAvailable(available);
        }
        return available;
      } catch {
        if (!cancelled) {
          setPersistenceAvailable(false);
        }
        return false;
      }
    };

    const scheduleRetry = () => {
      retryTimer = window.setTimeout(async () => {
        if (cancelled) return;
        const available = await loadPersistenceStatus(true);
        if (!cancelled && !available) {
          scheduleRetry();
        }
      }, 10_000);
    };

    void loadPersistenceStatus().then((available) => {
      if (!cancelled && available === false) {
        scheduleRetry();
      }
    });

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, []);

  const retryDatabaseConnection = async () => {
    setPersistenceRetryLoading(true);
    try {
      const response = await fetch(`${apiBase}/health?force=1`);
      if (!response.ok) {
        setPersistenceAvailable(false);
        return;
      }
      const data = (await response.json()) as { persistenceAvailable?: boolean };
      setPersistenceAvailable(Boolean(data.persistenceAvailable));
    } catch {
      setPersistenceAvailable(false);
    } finally {
      setPersistenceRetryLoading(false);
    }
  };

  const shippingMethodSelectOptions = useMemo(
    () => buildShippingMethodSelectOptions(quote.shippingOptions),
    [quote.shippingOptions],
  );
  const effectiveShippingMethod = useMemo(
    () => resolveEffectiveShippingMethod(quote),
    [quote.shippingMethod, quote.shippingOptions, quote.shippingTotal],
  );

  useEffect(() => {
    setQuote((prev) => {
      const resolved = resolveEffectiveShippingMethod(prev);
      const current = prev.shippingMethod ?? DEFAULT_SHIPPING_METHOD;
      if (resolved === current) return prev;
      const cartOption = findCartShippingOption(prev.shippingOptions, resolved);
      const nextShippingTotal = isTbdLabel(prev.shippingLabel)
        ? 0
        : cartOption?.price != null && cartOption.price > 0
          ? cartOption.price
          : prev.shippingTotal;
      return {
        ...prev,
        shippingMethod: resolved,
        shippingOptions: prev.shippingOptions?.length
          ? reconcileShippingSelectionWithTotal(
              prev.shippingOptions,
              nextShippingTotal,
              resolved,
            ).shippingOptions ?? prev.shippingOptions
          : prev.shippingOptions ?? null,
        ...recalcQuotePreservingTaxRate(prev, prev.items, {
          shippingTotal: nextShippingTotal,
          taxTotal: prev.taxTotal,
        }),
      };
    });
  }, [quote.shippingOptions, quote.shippingTotal]);

  const applyChargeInput = (field: "tax", rawValue: string) => {
    const trimmed = rawValue.trim();
    const numeric = Number(trimmed.replace(/[$,\s]/g, ""));
    const isNumeric = trimmed.length > 0 && Number.isFinite(numeric);
    const isTbd = trimmed.toLowerCase() === "tbd";

    setQuote((prev) => {
      const nextTaxTotal = isNumeric ? round2(numeric) : 0;
      const nextLabel =
        trimmed.length > 0 && !isNumeric ? (isTbd ? "TBD" : trimmed) : null;

      const recalculated = recalcQuotePreservingTaxRate(prev, prev.items, {
        taxTotal: nextTaxTotal,
      });

      return {
        ...prev,
        ...recalculated,
        taxLabel: nextLabel,
      };
    });
  };

  const applyShippingAmount = (rawValue: string) => {
    const trimmed = rawValue.trim();
    const numeric = Number(trimmed.replace(/[$,\s]/g, ""));
    const isNumeric = trimmed.length > 0 && Number.isFinite(numeric);
    const isTbd = trimmed.toLowerCase() === "tbd";

    setQuote((prev) => {
      const nextShippingTotal = isNumeric ? round2(numeric) : 0;
      const nextLabel =
        trimmed.length > 0 && !isNumeric ? (isTbd ? "TBD" : trimmed) : null;

      const recalculated = recalcQuotePreservingTaxRate(prev, prev.items, {
        shippingTotal: nextShippingTotal,
      });
      return {
        ...prev,
        ...recalculated,
        shippingLabel: nextLabel,
      };
    });
  };

  const cartTaxRatePercent = resolveTaxRatePercent(quote);

  /** Draft while the % field is focused so partial values like "10" are not overwritten. */
  const [taxPercentDraft, setTaxPercentDraft] = useState<string | null>(null);
  const [shippingDestinationDraft, setShippingDestinationDraft] = useState<string | null>(null);
  const [taxRowLabelDraft, setTaxRowLabelDraft] = useState<string | null>(null);
  const [taxAmountDraft, setTaxAmountDraft] = useState<string | null>(null);
  const [shippingAmountDraft, setShippingAmountDraft] = useState<string | null>(null);
  const shippingDestinationText = formatShippingDestination(quote.shippingState, quote.shippingZip);
  const shippingDestinationDisplay =
    shippingDestinationDraft !== null ? shippingDestinationDraft : shippingDestinationText;
  const taxRowLabelText = formatTaxRowLabel(quote.taxDescription, quote.shippingState);
  const taxRowLabelDisplay = taxRowLabelDraft !== null ? taxRowLabelDraft : taxRowLabelText;
  const taxAmountText = quote.taxLabel?.trim() ? quote.taxLabel : String(totals.taxTotal);
  const taxAmountDisplay = taxAmountDraft !== null ? taxAmountDraft : taxAmountText;
  const shippingAmountText = quote.shippingLabel?.trim()
    ? quote.shippingLabel
    : String(totals.shippingTotal);
  const shippingAmountDisplay =
    shippingAmountDraft !== null ? shippingAmountDraft : shippingAmountText;
  const grandTotalDisplay = quoteGrandTotalIsTbd(quote)
    ? "TBD"
    : currency(totals.grandTotal);

  const applyShippingDestination = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setQuote((prev) => ({ ...prev, shippingState: null, shippingZip: null }));
      return;
    }
    const { state, zip } = parseShippingDestinationText(trimmed);
    setQuote((prev) => ({
      ...prev,
      shippingState: state || null,
      shippingZip: zip || null,
    }));
  };

  const applyTaxRowLabel = (raw: string) => {
    const trimmed = raw.trim();
    setQuote((prev) => {
      const currentRate = resolveTaxRatePercent(prev);
      return {
        ...prev,
        taxDescription: trimmed || null,
        taxRatePercent: currentRate ?? prev.taxRatePercent ?? null,
      };
    });
  };

  const taxPercentDisplay =
    taxPercentDraft !== null ? taxPercentDraft : formatTaxRatePercentInput(cartTaxRatePercent);

  const applyTaxPercentFromString = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setQuote((prev) => {
        const recalculated = recalcQuotePreservingTaxRate(prev, prev.items, {
          taxTotal: 0,
          taxRatePercent: null,
        });
        return { ...prev, ...recalculated, taxRatePercent: null, taxLabel: null };
      });
      return;
    }
    const numeric = Number(trimmed.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(numeric)) return;

    setQuote((prev) => {
      const recalculated = recalcQuotePreservingTaxRate(prev, prev.items, {
        taxRatePercent: numeric,
      });
      return {
        ...prev,
        ...recalculated,
        taxRatePercent: numeric,
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
        ...recalcQuotePreservingTaxRate(prev, items),
      };
    });
  };

  const removeLine = (itemId: string) => {
    setQuote((prev) => {
      const items = prev.items.filter((i) => i.id !== itemId);
      return {
        ...prev,
        ...recalcQuotePreservingTaxRate(prev, items),
      };
    });
    setLineItemOptions((prev) => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const moveLineItem = (fromIndex: number, direction: "up" | "down") => {
    setQuote((prev) => {
      const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
      if (toIndex < 0 || toIndex >= prev.items.length) return prev;
      const items = [...prev.items];
      const moving = items[fromIndex];
      const target = items[toIndex];
      if (!moving || !target) return prev;
      items[fromIndex] = target;
      items[toIndex] = moving;
      const reordered = items.map((item, i) => ({ ...item, sortOrder: i + 1 }));
      return {
        ...prev,
        ...recalcQuotePreservingTaxRate(prev, reordered),
      };
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
          ...recalcQuotePreservingTaxRate(q, items),
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
    if (primary && secondary) return `${primary}${DESC_SECONDARY_SEPARATOR}${secondary}`;
    return primary || secondary;
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
    const primary = (selected[0] ?? "").trim();
    const secondary =
      selected.length > 1 ? selected.slice(1).join(" | ").trim() : "";
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

  const handleCustomImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const targetId = customImageTargetId;
    event.target.value = "";
    if (!file || !targetId) return;

    const item = quote.items.find((i) => i.id === targetId);
    if (!item || item.lineType !== "custom" || isQuoteDiscountLine(item)) {
      setCustomImageTargetId(null);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch(`${apiBase}/api/upload-image`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { image_url?: string; error?: string };
      if (!response.ok || !data.image_url) {
        alert(data?.error ?? "Failed to upload image");
        return;
      }

      setQuote((prev) => {
        const index = prev.items.findIndex((i) => i.id === targetId);
        if (index < 0) return prev;
        const items = [...prev.items];
        items[index] = {
          ...items[index],
          imageUrl: data.image_url,
          updatedAt: new Date().toISOString(),
        } as QuoteItem;
        return {
          ...prev,
          ...recalcQuotePreservingTaxRate(prev, items),
        };
      });
    } catch {
      alert("Failed to upload image");
    } finally {
      setCustomImageTargetId(null);
    }
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
        ...recalcQuotePreservingTaxRate(prev, items),
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

    const taxDescription = payload.taxDescription?.trim() || null;
    const parsedTaxRate = parseTaxRatePercentFromDescription(taxDescription);

    setQuote((prev) => {
      const items = [...prev.items, ...mappedItems];
      const taxRatePercent = parsedTaxRate ?? prev.taxRatePercent ?? null;
      const nextShippingTotal = payload.shippingTotal ?? prev.shippingTotal;
      const shippingOptions = mergeCartShippingOptions(prev.shippingOptions, payload.shippingOptions);
      const reconciled = reconcileShippingSelectionWithTotal(
        shippingOptions.length ? shippingOptions : payload.shippingOptions,
        nextShippingTotal,
        payload.selectedShippingValue ?? payload.selectedShippingOption?.value,
      );
      const reconciledOptions = reconciled.shippingOptions ?? shippingOptions;
      const cartResolved = cartPayloadHasShippingChoice(payload)
        ? resolveShippingMethodFromCartPayload({
            ...payload,
            shippingOptions: reconciledOptions,
            selectedShippingValue: reconciled.selectedShippingValue,
            selectedShippingOption: reconciled.selectedShippingOption,
          }, "")
        : "";
      const optionsResolved = resolveShippingMethodFromShippingOptions(
        reconciledOptions,
        "",
        nextShippingTotal,
      );
      const nextShippingMethod =
        cartResolved ||
        optionsResolved ||
        (prev.shippingMethod && prev.shippingMethod !== DEFAULT_SHIPPING_METHOD
          ? prev.shippingMethod
          : DEFAULT_SHIPPING_METHOD);

      return {
        ...prev,
        ...recalcQuotePreservingTaxRate(
          { ...prev, taxRatePercent },
          items,
          {
            shippingTotal: nextShippingTotal,
            taxTotal: payload.taxTotal ?? prev.taxTotal,
            taxRatePercent,
          }
        ),
        shippingLabel: payload.shippingLabel || prev.shippingLabel || null,
        shippingOptions: reconciledOptions.length ? reconciledOptions : prev.shippingOptions ?? null,
        shippingMethod: nextShippingMethod,
        shippingState: payload.shippingState?.trim() || prev.shippingState || null,
        shippingZip: payload.shippingZip?.trim() || prev.shippingZip || null,
        taxDescription: taxDescription || prev.taxDescription || null,
        taxRatePercent,
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
          ...recalcQuotePreservingTaxRate(prev, items),
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
      if (!cartPayloadHasImportableData(payload) && !cartPayloadHasShippingChoice(payload)) {
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

  const openLiveCartPage = async () => {
    setOpenLiveCartLoading(true);
    try {
      const response = await fetch(`${apiBase}/api/cart/open-cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const raw = await response.text();
      let data: { opened?: boolean; url?: string; error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        alert(`Failed to open cart (${response.status}). Restart the API server and try again.`);
        return;
      }
      if (!response.ok) {
        alert(data?.error ?? "Failed to open cart");
        return;
      }
      setLiveSessionUrl(data.url ?? liveSessionUrl);
    } finally {
      setOpenLiveCartLoading(false);
    }
  };

  const clearStorefrontCart = async () => {
    setClearCartLoading(true);
    setClearCartMessage(null);
    setClearCartError(null);
    try {
      const response = await fetch(`${apiBase}/quotes/clear-cart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as {
        success?: boolean;
        removedCount?: number;
        cartEmpty?: boolean;
        method?: string;
        error?: string;
      };
      if (!response.ok) {
        setClearCartError(data?.error ?? "Failed to clear cart");
        return;
      }
      if (data.cartEmpty) {
        setClearCartMessage("Cart cleared.");
      } else {
        setClearCartError("Cart could not be fully cleared.");
      }
    } catch {
      setClearCartError("Failed to clear cart");
    } finally {
      setClearCartLoading(false);
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
      if (!cartPayloadHasImportableData(data) && !cartPayloadHasShippingChoice(data)) {
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

  const saveQuote = async () => {
    const activeQuoteId = loadedQuoteId ?? (dbQuoteIdPattern.test(quote.id) ? quote.id : null);
    if (activeQuoteId) {
      const result = await Swal.fire({
        title: "Update existing quote?",
        text: `Quote "${quote.quoteNumber}" already exists. Save changes to this quote?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, update quote",
        cancelButtonText: "Cancel",
        reverseButtons: true,
      });
      if (!result.isConfirmed) return;
    }

    setSaveQuoteLoading(true);
    setSaveQuoteSuccess(null);
    setSaveQuoteError(null);
    try {
      const payload = {
        quote_number: quote.quoteNumber,
        quote_date: quoteDateToInputValue(quote.quoteDate),
        status: quote.status,
        version: quote.version,
        customer_name: quote.customerName ?? null,
        company: quote.customerCompany ?? null,
        email: quote.customerEmail ?? null,
        phone: quote.customerPhone ?? null,
        address: quote.customerAddress ?? null,
        notes: quote.notes ?? null,
        subtotal: Number(totals.subtotal),
        shipping: Number(totals.shippingTotal),
        shipping_label: quote.shippingLabel ?? null,
        shipping_method: serializeShippingMethodForDb(quote.shippingMethod),
        shipping_options_json: quote.shippingOptions?.length ? quote.shippingOptions : null,
        shipping_state: quote.shippingState ?? null,
        shipping_zip: quote.shippingZip ?? null,
        tax_rate: quote.taxRatePercent != null ? Number(quote.taxRatePercent / 100) : null,
        tax_amount: Number(totals.taxTotal),
        tax_label: quote.taxLabel ?? null,
        tax_description: quote.taxDescription ?? null,
        total: Number(totals.grandTotal),
        items: quote.items.map((item) => ({
          product_code: item.sku ?? item.sourceProductId ?? null,
          description: item.name ?? null,
          optional_description: item.description ?? null,
          image_url: item.imageUrl || null,
          qty: Number(item.qty),
          unit_price: Number(item.unitPrice),
          amount: Number(item.lineTotal),
          options_json:
            item.chosenOptions?.length || item.imageUrl
              ? {
                  ...(item.chosenOptions?.length ? { chosen_options: item.chosenOptions } : {}),
                  ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
                }
              : null,
        })),
      };

      const method = activeQuoteId ? "PUT" : "POST";
      const url = activeQuoteId
        ? `${apiBase}/api/quotes/${encodeURIComponent(activeQuoteId)}`
        : `${apiBase}/api/quotes`;
      console.log("[saveQuote] request:", { quoteId: activeQuoteId, method, url });

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const isJson = contentType.includes("application/json");
      const parsedBody = isJson
        ? ((await response.json()) as {
            id?: string;
            error?: string;
            message?: string;
            persisted?: boolean;
            offline?: boolean;
          })
        : await response.text();
      console.log("[saveQuote] response:", { quoteId: activeQuoteId, method, url, response: parsedBody });

      if (response.ok && isJson && parsedBody && typeof parsedBody === "object") {
        const body = parsedBody as { offline?: boolean; persisted?: boolean; message?: string };
        if (body.offline && body.persisted === false) {
          setSaveQuoteSuccess(
            body.message ?? "Quote kept locally only — database is unavailable.",
          );
          return;
        }
      }

      if (!response.ok) {
        if (isJson) {
          const data = parsedBody as { error?: string; message?: string };
          throw new Error(data?.error ?? data?.message ?? `Failed to save quote (${response.status})`);
        }
        const text = String(parsedBody).trim();
        throw new Error(
          text
            ? `Failed to save quote (${response.status}): ${text.slice(0, 300)}`
            : `Failed to save quote (${response.status})`,
        );
      }
      if (isJson && parsedBody && typeof parsedBody === "object" && "id" in parsedBody) {
        const nextId = String((parsedBody as { id?: string }).id ?? "").trim() || null;
        if (nextId) {
          setLoadedQuoteId(nextId);
          setQuote((prev) => ({ ...prev, id: nextId }));
        }
      }
      setSaveQuoteSuccess(`Quote ${quote.quoteNumber} saved.`);
    } catch (error) {
      console.error("Save quote failed:", error);
      setSaveQuoteError(error instanceof Error ? error.message : "Failed to save quote");
    } finally {
      setSaveQuoteLoading(false);
    }
  };

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const response = await fetch(`${apiBase}/api/quotes/search?q=${encodeURIComponent(q)}`);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        const isJson = contentType.includes("application/json");
        const parsedBody = isJson
          ? ((await response.json()) as { data?: QuoteSearchResult[]; error?: string; message?: string })
          : await response.text();

        if (!response.ok) {
          if (isJson) {
            const data = parsedBody as { error?: string; message?: string };
            throw new Error(data?.error ?? data?.message ?? "Failed to search quotes");
          }
          throw new Error(String(parsedBody || "Failed to search quotes"));
        }

        const data = parsedBody as { data?: QuoteSearchResult[]; offline?: boolean };
        if (data.offline) {
          setSearchError("Quote search is unavailable — database is not connected.");
        }
        setSearchResults(Array.isArray(data.data) ? data.data : []);
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : "Failed to search quotes");
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const loadQuoteById = async (quoteId: string) => {
    setLoadQuoteLoadingId(quoteId);
    setSaveQuoteSuccess(null);
    setSaveQuoteError(null);
    try {
      const response = await fetch(`${apiBase}/api/quotes/${encodeURIComponent(quoteId)}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const isJson = contentType.includes("application/json");
      const parsedBody = isJson
        ? ((await response.json()) as ApiQuote & { error?: string; message?: string })
        : await response.text();

      if (!response.ok) {
        if (isJson) {
          const data = parsedBody as { error?: string; message?: string };
          throw new Error(data?.error ?? data?.message ?? `Failed to load quote (${response.status})`);
        }
        throw new Error(`Failed to load quote (${response.status}): ${String(parsedBody).slice(0, 300)}`);
      }

      const data = parsedBody as ApiQuote;
      const now = new Date().toISOString();
      const items = (Array.isArray(data.items) ? data.items : []).map((item, index) => {
        const qty = asNumber(item.qty) || 1;
        const unitPrice = asNumber(item.unitPrice ?? item.unit_price ?? null);
        const amount = asNumber(item.amount);
        const calculatedAmount = amount || round2(qty * unitPrice);
        const productCode = item.productCode ?? item.product_code ?? null;
        const options = item.optionsJson ?? item.options_json ?? null;
        const imageFromDb = (item.imageUrl ?? item.image_url ?? "").trim() || null;
        const imageFromOptions = options?.image_url?.trim() || null;
        return {
          id: item.id ?? `qi_loaded_${Date.now()}_${index}`,
          quoteId: data.id,
          lineType: productCode ? "product" : "custom",
          sourceProductId: productCode,
          sku: productCode,
          imageUrl: imageFromDb ?? imageFromOptions,
          name: item.description ?? productCode ?? "Line Item",
          description: item.optionalDescription ?? item.optional_description ?? null,
          chosenOptions: options?.chosen_options ?? null,
          qty,
          unitPrice,
          discountType: "none",
          discountValue: 0,
          discountScope: null,
          sortOrder: index + 1,
          lineSubtotal: calculatedAmount,
          lineDiscountTotal: 0,
          lineTotal: calculatedAmount,
          createdAt: item.createdAt ?? now,
          updatedAt: item.updatedAt ?? now,
        } as QuoteItem;
      });

      const loadedShippingTotal = asNumber(data.shipping);
      const loadedShippingOptions = parseShippingOptionsFromDb(
        data.shippingOptionsJson ?? data.shipping_options_json,
      );

      const draft: Quote = {
        id: data.id,
        quoteNumber: data.quoteNumber ?? "",
        status: data.status === "final" ? "final" : "draft",
        version: asNumber(data.version) || 1,
        customerName: data.customerName ?? null,
        customerCompany: data.company ?? null,
        customerEmail: data.email ?? null,
        customerPhone: data.phone ?? null,
        customerAddress: data.address ?? null,
        notes: data.notes ?? null,
        subtotal: 0,
        discountTotal: 0,
        shippingTotal: loadedShippingTotal,
        shippingLabel: data.shippingLabel ?? null,
        shippingMethod: resolveEffectiveShippingMethod({
          shippingMethod: parseShippingMethodFromDb(data.shippingMethod),
          shippingOptions: loadedShippingOptions,
          shippingTotal: loadedShippingTotal,
        }),
        shippingOptions: loadedShippingOptions,
        shippingState: data.shippingState ?? null,
        shippingZip: data.shippingZip ?? null,
        taxTotal: asNumber(data.taxAmount),
        taxLabel: data.taxLabel ?? null,
        taxDescription: data.taxDescription ?? null,
        taxRatePercent: data.taxRate != null ? asNumber(data.taxRate) * 100 : null,
        grandTotal: 0,
        items,
        createdAt: now,
        updatedAt: now,
        quoteDate: data.quoteDate ? new Date(data.quoteDate).toLocaleDateString("en-US") : todayQuoteDate(),
      };

      const recalculated = recalcQuotePreservingTaxRate(draft, items, {
        shippingTotal: draft.shippingTotal,
        taxTotal: draft.taxTotal,
      });
      setQuote({ ...draft, ...recalculated });
      setLoadedQuoteId(data.id);
      setLineItemOptions({});
      setSearchQuery("");
      setSearchResults([]);
    } catch (error) {
      setSaveQuoteError(error instanceof Error ? error.message : "Failed to load quote");
    } finally {
      setLoadQuoteLoadingId(null);
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
      {persistenceAvailable === false ? (
        <div
          className="card section"
          style={{
            marginBottom: 16,
            background: "#fffbeb",
            border: "1px solid #f59e0b",
            color: "#92400e",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            <strong>Database offline.</strong> The app tries office LAN and Tailscale automatically.
            Connect to your network, then retry - no restart needed.
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => void retryDatabaseConnection()}
            disabled={persistenceRetryLoading}
          >
            {persistenceRetryLoading ? "Checking..." : "Retry connection"}
          </button>
        </div>
      ) : null}
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
                setLoadedQuoteId(null);
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
        <div style={{ marginTop: 12, maxWidth: 560, position: "relative" }}>
          <label htmlFor="quote-search">Search Saved Quotes</label>
          <input
            id="quote-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by quote #, customer, company, or email"
            style={{ marginTop: 6 }}
          />
          {searchLoading ? <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Searching...</div> : null}
          {searchError ? <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>{searchError}</div> : null}
          {searchQuery.trim() && searchResults.length > 0 ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                zIndex: 20,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                background: "#fff",
                marginTop: 6,
                maxHeight: 260,
                overflowY: "auto",
              }}
            >
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => loadQuoteById(result.id)}
                  disabled={Boolean(loadQuoteLoadingId)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderBottom: "1px solid #f1f5f9",
                    background: "#fff",
                    padding: "9px 10px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{result.quoteNumber || "(no quote #)"}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[result.customerName, result.company, result.email].filter(Boolean).join(" · ")}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
          {loadQuoteLoadingId ? (
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Loading selected quote...
            </div>
          ) : null}
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
            <input
              type="date"
              value={quoteDateToInputValue(quote.quoteDate)}
              onChange={(e) =>
                setQuote((prev) => ({ ...prev, quoteDate: inputValueToQuoteDate(e.target.value) }))
              }
            />
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
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      <button
                        type="button"
                        className="line-item-move-btn"
                        aria-label={`Move ${item.name} up`}
                        title="Move up"
                        disabled={index === 0 || quote.items.length <= 1}
                        onClick={() => moveLineItem(index, "up")}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M12 19V5M5 12l7-7 7 7"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="line-item-move-btn"
                        aria-label={`Move ${item.name} down`}
                        title="Move down"
                        disabled={index === quote.items.length - 1 || quote.items.length <= 1}
                        onClick={() => moveLineItem(index, "down")}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M12 5v14M5 12l7 7 7-7"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
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
              {liveSessionUrl ? (
                <button
                  type="button"
                  className="btn"
                  onClick={openLiveCartPage}
                  disabled={openLiveCartLoading || identifyLoading}
                  style={{ marginRight: 8 }}
                >
                  {openLiveCartLoading ? "Opening cart…" : "Open Cart"}
                </button>
              ) : null}
              <button
                type="button"
                className="btn primary"
                onClick={copyCartViaServer}
                disabled={
                  scrapeCartServerLoading ||
                  openCartSessionLoading ||
                  openLiveCartLoading ||
                  identifyLoading
                }
              >
                {scrapeCartServerLoading ? "Reading live cart…" : "Add Products From Cart"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={clearStorefrontCart}
                disabled={
                  clearCartLoading ||
                  scrapeCartServerLoading ||
                  openCartSessionLoading ||
                  openLiveCartLoading ||
                  identifyLoading
                }
                style={{ marginLeft: 8 }}
              >
                {clearCartLoading ? "Clearing cart..." : "Clear Cart"}
              </button>
            </div>
            {clearCartMessage ? (
              <div className="muted" style={{ marginTop: 8, fontSize: 12, color: "var(--success, #0a7a2f)" }}>
                {clearCartMessage}
              </div>
            ) : null}
            {clearCartError ? (
              <div className="muted" style={{ marginTop: 8, fontSize: 12, color: "var(--danger, #b42318)" }}>
                {clearCartError}
              </div>
            ) : null}
            {liveSessionUrl ? (
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Live session page: {liveSessionUrl}
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: 10, fontSize: 14, display: "none" }}>
            Identified Email: {identifiedEmail ?? "Not found"}
          </div>
          {/* {lastCartPayload ? (
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
          ) : null} */}
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
            <div
              className="totals-row"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ flexShrink: 0 }}>Shipping</span>
              <select
                aria-label="Shipping method"
                value={effectiveShippingMethod}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setQuote((prev) => {
                    const cartOption = findCartShippingOption(prev.shippingOptions, nextValue);
                    const nextShippingTotal = isTbdLabel(prev.shippingLabel)
                      ? 0
                      : cartOption?.price != null && cartOption.price > 0
                        ? cartOption.price
                        : prev.shippingTotal;
                    return {
                      ...prev,
                      shippingMethod: nextValue,
                      ...recalcQuotePreservingTaxRate(prev, prev.items, {
                        shippingTotal: nextShippingTotal,
                        taxTotal: prev.taxTotal,
                      }),
                    };
                  });
                }}
                style={{
                  flex: "1 1 auto",
                  width: 40,
                  minWidth: 40,
                  maxWidth: 118,
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "8px 28px 8px 10px",
                  fontSize: 14,
                  font: "inherit",
                  background: "#fff",
                  color: "#1f2937",
                  cursor: "pointer",
                }}
              >
                {shippingMethodSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {formatShippingOptionDisplayLabel(option.label)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={shippingDestinationDisplay}
                onFocus={() => setShippingDestinationDraft(shippingDestinationText)}
                onBlur={() => {
                  applyShippingDestination(shippingDestinationDraft ?? shippingDestinationText);
                  setShippingDestinationDraft(null);
                }}
                onChange={(e) => setShippingDestinationDraft(e.target.value)}
                placeholder="e.g. NJ, 07045"
                aria-label="Shipping destination"
                style={{ flex: 1, minWidth: 0, maxWidth: 160 }}
              />
              <input
                type="text"
                value={shippingAmountDisplay}
                onFocus={() => setShippingAmountDraft(shippingAmountText)}
                onBlur={() => {
                  if (shippingAmountDraft !== null && shippingAmountDraft !== shippingAmountText) {
                    applyShippingAmount(shippingAmountDraft);
                  }
                  setShippingAmountDraft(null);
                }}
                onChange={(e) => {
                  const v = e.target.value;
                  setShippingAmountDraft(v);
                  applyShippingAmount(v);
                }}
                placeholder="e.g. 0 or TBD"
                aria-label="Shipping amount"
                style={{ maxWidth: 120, textAlign: "right", flexShrink: 0 }}
              />
            </div>
            <div className="totals-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <input
                type="text"
                value={taxRowLabelDisplay}
                onFocus={() => setTaxRowLabelDraft(taxRowLabelText)}
                onBlur={() => {
                  if (taxRowLabelDraft !== null && taxRowLabelDraft !== taxRowLabelText) {
                    applyTaxRowLabel(taxRowLabelDraft);
                  }
                  setTaxRowLabelDraft(null);
                }}
                onChange={(e) => setTaxRowLabelDraft(e.target.value)}
                placeholder="Tax"
                aria-label="Tax label"
                style={{ flex: 1, minWidth: 0, maxWidth: 200 }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={taxPercentDisplay}
                    onFocus={() => setTaxPercentDraft(formatTaxRatePercentInput(cartTaxRatePercent))}
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
                  type="text"
                  value={taxAmountDisplay}
                  onFocus={() => setTaxAmountDraft(taxAmountText)}
                  onBlur={() => {
                    if (taxAmountDraft !== null && taxAmountDraft !== taxAmountText) {
                      applyChargeInput("tax", taxAmountDraft);
                    }
                    setTaxAmountDraft(null);
                  }}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTaxAmountDraft(v);
                    applyChargeInput("tax", v);
                  }}
                  placeholder="e.g. 0 or TBD"
                  aria-label="Tax amount"
                  style={{ maxWidth: 120, textAlign: "right" }}
                />
              </div>
            </div>
            <div className="totals-row total">
              <span>Total</span>
              <span>{grandTotalDisplay}</span>
            </div>
          </div>
        </div>
        <div className="section" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {saveQuoteSuccess ? <span style={{ color: "#166534", fontWeight: 600 }}>{saveQuoteSuccess}</span> : null}
          {saveQuoteError ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>{saveQuoteError}</span> : null}
          <button
            type="button"
            className="btn primary"
            onClick={saveQuote}
            disabled={saveQuoteLoading}
          >
            {saveQuoteLoading ? "Saving..." : "SAVE QUOTE"}
          </button>
        </div>
      </div>
    </main>
  );
}

"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { getApiBase } from "../../lib/apiBase";
import { extractCartFromPage, type CartPayload } from "../../lib/extractCartFromPage";
import { QuoteLineItemImageGallery } from "../../components/QuoteLineItemImageGallery";
import QuoteExportButtons from "../../components/QuoteExportButtons";
import QuoteInternalAttachments from "../../components/QuoteInternalAttachments";
import {
  createEmptyQuote,
  normalizeEstimateValidDays,
  normalizeSalesContact,
  SALES_CONTACTS,
  Quote,
  QuoteItem,
} from "../../lib/mockQuote";
import {
  normalizeInternalAttachments,
  type QuoteAttachmentSearchHit,
} from "../../lib/quoteAttachments";
import { customerInfoFromPaste, formatCustomerInfoBlock } from "../../lib/customerInfo";
import { isQuoteDiscountLine } from "../../lib/quoteDiscount";
import { normalizeExtraImageUrls } from "../../lib/quoteItemImages";
import { recalcQuote, recalcQuotePreservingTaxRate, round2 } from "../../lib/recalcQuote";
import { formatShippingDestination } from "../../lib/shippingDestination";
import {
  buildShippingMethodSelectOptions,
  formatShippingOptionDisplayLabel,
  cartPayloadHasShippingChoice,
  CUSTOM_SHIPPING_METHOD_VALUE,
  customShippingMethodText,
  DEFAULT_SHIPPING_METHOD,
  findCartShippingOption,
  isCustomShippingMethod,
  mergeCartShippingOptions,
  parseShippingMethodFromDb,
  parseShippingOptionsFromDb,
  resolveEffectiveShippingMethod,
  resolveShippingMethodFromCartPayload,
  resolveShippingMethodFromShippingOptions,
  reconcileShippingSelectionWithTotal,
  serializeShippingMethodForDb,
  shippingMethodSelectValue,
  withCustomShippingText,
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
import { mapQuoteItemsForCreate, normalizeQuoteNumber } from "../../lib/quoteSaveAction";
import { isAutoDateQuoteNumber } from "../../lib/sequentialQuoteNumber";
import { collectOptionsForCartLine, deserializeQuoteItemFromDb, mapCartRowsToQuoteItems } from "../../lib/cartImport";
import {
  looksLikeCartId,
  looksLikeEmail,
  isAbandonedCartGuid,
  normalizeAbandonedCartLines,
} from "../../lib/abandonedCart";
import type { AbandonedCartLine, AbandonedCartSummary } from "../../lib/abandonedCart";
import { version as packageVersion } from "../../package.json";
import { useAppUpdater } from "../../components/ElectronUpdaterBridge";
import AddPopupWindow from "../../components/AddPopupWindow";
import QuoteCalculator, { PriceCalculatorTrigger } from "../../components/QuoteCalculator";

function currency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function todayQuoteDate(): string {
  return new Date().toLocaleDateString("en-US");
}

/** Parse calendar dates without UTC timezone shift (DATEONLY / YYYY-MM-DD). */
function parseQuoteCalendarParts(
  value: string | Date | null | undefined,
): { y: number; m: number; d: number } | null {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Sequelize DATEONLY / JSON ISO midnight is UTC — use UTC parts.
    return {
      y: value.getUTCFullYear(),
      m: value.getUTCMonth() + 1,
      d: value.getUTCDate(),
    };
  }

  const trimmed = String(value).trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  }
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    return { y: Number(us[3]), m: Number(us[1]), d: Number(us[2]) };
  }
  return null;
}

function formatQuoteDateEnUs(parts: { y: number; m: number; d: number }): string {
  return new Date(parts.y, parts.m - 1, parts.d).toLocaleDateString("en-US");
}

/** `quoteDate` is stored as en-US (e.g. `5/21/2026`); `<input type="date">` needs `YYYY-MM-DD`. */
function quoteDateToInputValue(quoteDate: string): string {
  const parts = parseQuoteCalendarParts(quoteDate) ?? parseQuoteCalendarParts(todayQuoteDate());
  if (!parts) return "";
  const m = String(parts.m).padStart(2, "0");
  const d = String(parts.d).padStart(2, "0");
  return `${parts.y}-${m}-${d}`;
}

function inputValueToQuoteDate(iso: string): string {
  const parts = parseQuoteCalendarParts(iso);
  return parts ? formatQuoteDateEnUs(parts) : todayQuoteDate();
}

function dbQuoteDateToQuoteDate(value: string | Date | null | undefined): string {
  const parts = parseQuoteCalendarParts(value);
  return parts ? formatQuoteDateEnUs(parts) : todayQuoteDate();
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
  attachmentHits?: QuoteAttachmentSearchHit[];
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
  optionsJson?: {
    chosen_options?: string[];
    available_options?: string[];
    image_url?: string;
    extra_image_urls?: string[];
    import_line_id?: string;
    discount_scope?: "quote";
    discount_type?: "amount" | "percent";
    discount_value?: number;
  } | null;
  options_json?: {
    chosen_options?: string[];
    available_options?: string[];
    image_url?: string;
    extra_image_urls?: string[];
    import_line_id?: string;
    discount_scope?: "quote";
    discount_type?: "amount" | "percent";
    discount_value?: number;
  } | null;
  createdAt?: string;
  updatedAt?: string;
};

type ApiQuote = {
  id: string;
  quoteNumber?: string;
  quote_number?: string;
  quoteDate: string | null;
  status: string;
  version: string | number;
  customerName: string | null;
  customerId?: string | null;
  customer_id?: string | null;
  deliveryDeadline?: string | null;
  delivery_deadline?: string | null;
  artDeadline?: string | null;
  art_deadline?: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  internalNotes?: string | null;
  internal_notes?: string | null;
  estimateValidDays?: number | string | null;
  estimate_valid_days?: number | string | null;
  salesContact?: string | null;
  sales_contact?: string | null;
  abandonedCartId?: string | null;
  abandoned_cart_id?: string | null;
  abandonedCartLines?: AbandonedCartLine[] | null;
  abandoned_cart_lines?: AbandonedCartLine[] | null;
  abandonedCartLinesJson?: AbandonedCartLine[] | null;
  abandoned_cart_lines_json?: AbandonedCartLine[] | null;
  internalAttachmentsJson?: unknown;
  internal_attachments_json?: unknown;
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

type CalculatorTarget = {
  itemId: string;
  field: "unitPrice" | "discountValue";
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

function readApiQuoteNumber(data: { quoteNumber?: string; quote_number?: string }): string {
  return normalizeQuoteNumber(data.quoteNumber ?? data.quote_number);
}

function shouldAssignNextQuoteNumber(candidate: { id: string; quoteNumber: string }): boolean {
  if (dbQuoteIdPattern.test(candidate.id)) return false;
  const quoteNumber = candidate.quoteNumber.trim();
  return !quoteNumber || isAutoDateQuoteNumber(quoteNumber);
}

export default function QuoteBuilderPage() {
  const { state: updaterState } = useAppUpdater();
  const appVersion = updaterState.currentVersion || packageVersion;
  const [quote, setQuote] = useState<Quote>(() => createEmptyQuote());
  const [loadedQuoteId, setLoadedQuoteId] = useState<string | null>(null);
  const [originalLoadedQuoteNumber, setOriginalLoadedQuoteNumber] = useState<string | null>(null);
  const [abandonedCartQuery, setAbandonedCartQuery] = useState("");
  const skipNextPersist = useRef(false);
  const customImageInputRef = useRef<HTMLInputElement | null>(null);
  const [customImageTargetId, setCustomImageTargetId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stored = loadQuoteFromPreviewStorage();
    if (stored) {
      setQuote({
        ...stored,
        internalAttachments: normalizeInternalAttachments(stored.internalAttachments),
        abandonedCartId: stored.abandonedCartId?.trim() || null,
        abandonedCartLines: normalizeAbandonedCartLines(stored.abandonedCartLines).length
          ? normalizeAbandonedCartLines(stored.abandonedCartLines)
          : null,
        shippingMethod: resolveEffectiveShippingMethod(stored),
        shippingOptions: stored.shippingOptions?.length
          ? reconcileShippingSelectionWithTotal(
            stored.shippingOptions,
            stored.shippingTotal,
            stored.shippingMethod,
          ).shippingOptions ?? stored.shippingOptions
          : stored.shippingOptions ?? null,
      });
      setAbandonedCartQuery(stored.abandonedCartId?.trim() || "");
      setLoadedQuoteId(dbQuoteIdPattern.test(stored.id) ? stored.id : null);
      setOriginalLoadedQuoteNumber(stored.quoteNumber?.trim() || null);
      skipNextPersist.current = true;
    }
  }, []);

  const [quoteNumberNotice, setQuoteNumberNotice] = useState<string | null>(null);

  const assignNextQuoteNumber = async (options?: { force?: boolean }): Promise<string | null> => {
    setQuoteNumberNotice(null);
    try {
      const response = await fetch(`${getApiBase()}/api/quotes/next-number`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const parsed = contentType.includes("application/json")
        ? ((await response.json()) as { quoteNumber?: string; error?: string; offline?: boolean })
        : null;
      if (!response.ok || !parsed?.quoteNumber) {
        throw new Error(parsed?.error ?? "Could not assign the next quote number");
      }
      const quoteNumber = parsed.quoteNumber;
      setQuote((prev) => {
        if (!options?.force && !shouldAssignNextQuoteNumber(prev)) return prev;
        return { ...prev, quoteNumber };
      });
      return quoteNumber;
    } catch (error) {
      setQuoteNumberNotice(
        error instanceof Error ? error.message : "Could not assign the next quote number",
      );
      return null;
    }
  };

  useEffect(() => {
    const stored = loadQuoteFromPreviewStorage();
    const candidate = stored ?? createEmptyQuote();
    if (!shouldAssignNextQuoteNumber(candidate)) return;
    void assignNextQuoteNumber();
    // Assign once when a new quote opens. Saved quotes and already numbered drafts are left alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [abandonedCartSearchLoading, setAbandonedCartSearchLoading] = useState(false);
  const [abandonedCartRebuildLoading, setAbandonedCartRebuildLoading] = useState(false);
  const [abandonedCartSearchResults, setAbandonedCartSearchResults] = useState<AbandonedCartSummary[]>([]);
  const [abandonedCartMessage, setAbandonedCartMessage] = useState<string | null>(null);
  const [abandonedCartError, setAbandonedCartError] = useState<string | null>(null);
  const [showAbandonedCartDevTools, setShowAbandonedCartDevTools] = useState(false);
  const [calculatorTarget, setCalculatorTarget] = useState<CalculatorTarget | null>(null);
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
  const canSaveQuote = quote.items.length > 0;

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

    const loadPersistenceStatus = async (force = false) => {
      try {
        const query = force ? "?force=1" : "";
        const response = await fetch(`${getApiBase()}/health${query}`);
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
      const response = await fetch(`${getApiBase()}/health?force=1`);
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
  const selectedShippingMethodValue = shippingMethodSelectValue(effectiveShippingMethod);
  const customShippingSelected =
    selectedShippingMethodValue === CUSTOM_SHIPPING_METHOD_VALUE ||
    (!shippingMethodSelectOptions.some((option) => option.value === selectedShippingMethodValue) &&
      shippingMethodSelectOptions.length === 1 &&
      shippingMethodSelectOptions[0]?.value === CUSTOM_SHIPPING_METHOD_VALUE);

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
  const [estimateValidDaysDraft, setEstimateValidDaysDraft] = useState<string | null>(null);
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
    setQuote((prev) => ({
      ...prev,
      shippingState: trimmed || null,
      shippingZip: null,
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

  const togglePriceCalculator = (itemId: string, field: CalculatorTarget["field"]) => {
    setCalculatorTarget((prev) =>
      prev?.itemId === itemId && prev.field === field ? null : { itemId, field },
    );
  };

  const applyCalculatorValue = (value: number) => {
    if (!calculatorTarget) return;
    const index = quote.items.findIndex((item) => item.id === calculatorTarget.itemId);
    if (index < 0) return;
    const n = round2(value);
    if (calculatorTarget.field === "discountValue") {
      updateItem(index, { discountValue: Math.max(0, n) });
    } else {
      updateItem(index, { unitPrice: n });
    }
    setCalculatorTarget(null);
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

  const removeItemImage = (itemId: string, imageUrl: string) => {
    const targetUrl = imageUrl.trim();
    if (!targetUrl) return;

    setQuote((prev) => {
      const index = prev.items.findIndex((i) => i.id === itemId);
      if (index < 0) return prev;
      const current = prev.items[index];
      if (!current) return prev;
      const primary = current.imageUrl?.trim() || null;
      const extras = (current.extraImageUrls ?? [])
        .map((url) => url.trim())
        .filter(Boolean);

      let nextPrimary = primary;
      let nextExtras = extras;

      if (primary === targetUrl) {
        nextPrimary = null;
      } else {
        nextExtras = extras.filter((url) => url !== targetUrl);
      }

      const items = [...prev.items];
      items[index] = {
        ...current,
        imageUrl: nextPrimary,
        extraImageUrls: nextExtras.length ? nextExtras : null,
        updatedAt: new Date().toISOString(),
      } as QuoteItem;
      return {
        ...prev,
        ...recalcQuotePreservingTaxRate(prev, items),
      };
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

  const collectAvailableOptionsForItem = (
    item: QuoteItem,
    payloadItems: CartPayload["cartItems"] = lastCartPayload?.cartItems ?? [],
  ): string[] => {
    if (item.availableOptions?.length) {
      return item.availableOptions.map((option) => option.trim()).filter(Boolean);
    }
    if (!payloadItems.length) {
      return item.chosenOptions?.length ? [...item.chosenOptions] : [];
    }
    return collectOptionsForCartLine(item, payloadItems);
  };

  const getLineOptions = async (item: QuoteItem) => {
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

    let options = collectAvailableOptionsForItem(item);

    // Older scrapes missed options after Volusion moved to javascript:void(0) popups.
    // Re-scrape the live cart once so Get Options can show the checkbox list.
    if (!options.length) {
      setScrapeCartServerLoading(true);
      try {
        const response = await fetch(`${getApiBase()}/quotes/scrape-cart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (response.ok) {
          const data = (await response.json()) as CartPayload;
          if (Array.isArray(data.cartItems) && data.cartItems.length) {
            setLastCartPayload(data);
            rememberAbandonedCartId(data.cartId);
            options = collectAvailableOptionsForItem(item, data.cartItems);

            // Attach scraped options onto the quote line so Get Options keeps working
            // even if lastCartPayload is cleared later.
            if (options.length) {
              setQuote((prev) => {
                const items = prev.items.map((entry) =>
                  entry.id === item.id
                    ? {
                        ...entry,
                        availableOptions: options,
                        updatedAt: new Date().toISOString(),
                      }
                    : entry,
                );
                return { ...prev, items };
              });
            }
          }
        }
      } catch {
        /* keep empty options / error below */
      } finally {
        setScrapeCartServerLoading(false);
      }
    }

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
    if (!item || isQuoteDiscountLine(item)) {
      setCustomImageTargetId(null);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch(`${getApiBase()}/api/upload-image`, {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { image_url?: string; error?: string };
      if (!response.ok || !data.image_url) {
        alert(data?.error ?? "Failed to upload image");
        return;
      }
      const uploadedUrl = data.image_url.trim();

      setQuote((prev) => {
        const index = prev.items.findIndex((i) => i.id === targetId);
        if (index < 0) return prev;
        const current = prev.items[index];
        if (!current) return prev;
        const primary = current.imageUrl?.trim() || null;
        const extras = (current.extraImageUrls ?? [])
          .map((url) => url.trim())
          .filter(Boolean);

        // Always add — keep existing product image and append custom uploads.
        if (!primary) {
          const items = [...prev.items];
          items[index] = {
            ...current,
            imageUrl: uploadedUrl,
            updatedAt: new Date().toISOString(),
          } as QuoteItem;
          return {
            ...prev,
            ...recalcQuotePreservingTaxRate(prev, items),
          };
        }

        if (primary === uploadedUrl || extras.includes(uploadedUrl)) {
          return prev;
        }

        const items = [...prev.items];
        items[index] = {
          ...current,
          extraImageUrls: [...extras, uploadedUrl],
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
      description: isDiscount ? "Quote discount" : "",
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

  /** Persist CartIDLog line snapshot on the quote (survives ClearCart deleting the GUID). */
  const rememberAbandonedCartLines = (lines: AbandonedCartLine[] | null | undefined) => {
    const normalized = normalizeAbandonedCartLines(lines);
    setQuote((prev) => ({
      ...prev,
      abandonedCartLines: normalized.length ? normalized : null,
    }));
  };

  /** Snapshot admin cart contents for a GUID (read-only; no storefront clear). */
  const snapshotAbandonedCartFromAdmin = async (cartId: string) => {
    const id = cartId.trim();
    if (!isAbandonedCartGuid(id)) return;
    try {
      const response = await fetch(`${getApiBase()}/quotes/abandoned-carts/contents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: id }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { items?: AbandonedCartLine[] };
      const lines = normalizeAbandonedCartLines(data.items);
      if (lines.length) rememberAbandonedCartLines(lines);
    } catch {
      /* snapshot is best-effort */
    }
  };

  /** Fill Load abandoned/live cart input + quote field from a CartIDLog GUID. */
  const rememberAbandonedCartId = (cartId: string | null | undefined) => {
    const id = String(cartId ?? "").trim();
    if (!isAbandonedCartGuid(id)) return;
    setAbandonedCartQuery(id);
    setQuote((prev) =>
      prev.abandonedCartId === id ? prev : { ...prev, abandonedCartId: id },
    );
    void snapshotAbandonedCartFromAdmin(id);
  };

  const appendScrapedCartPayload = (payload: CartPayload) => {
    rememberAbandonedCartId(payload.cartId);
    const now = new Date().toISOString();
    const mappedItems = mapCartRowsToQuoteItems({
      cartItems: payload.cartItems,
      quoteId: quote.id,
      startSortOrder: quote.items.length,
      now,
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
      const response = await fetch(`${getApiBase()}/quotes/products?codes=${encodeURIComponent(codes)}`);
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
      rememberAbandonedCartId(payload.cartId);
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
      const response = await fetch(`${getApiBase()}/api/cart/open-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as {
        opened?: boolean;
        url?: string;
        error?: string;
      };
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
      const response = await fetch(`${getApiBase()}/api/cart/open-cart`, {
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
    if (!liveSessionUrl) {
      setClearCartError("Open Live Website Session first, then use Clear Cart.");
      return;
    }
    setClearCartLoading(true);
    setClearCartMessage(null);
    setClearCartError(null);
    try {
      const response = await fetch(`${getApiBase()}/quotes/clear-cart`, {
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
    if (!liveSessionUrl) {
      alert("Open Live Website Session first, then use Add Products From Cart.");
      return;
    }
    setScrapeCartServerLoading(true);
    try {
      const response = await fetch(`${getApiBase()}/quotes/scrape-cart`, {
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
      rememberAbandonedCartId(data.cartId);
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
      const response = await fetch(`${getApiBase()}/quotes/identify-user`, {
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

  const rebuildAbandonedCart = async (cartId: string) => {
    const id = cartId.trim();
    if (!looksLikeCartId(id)) {
      setAbandonedCartError("Enter a valid cart GUID");
      return;
    }
    if (!liveSessionUrl) {
      setAbandonedCartError('Open Live Website Session first, then use "Load into cart"');
      return;
    }
    setAbandonedCartQuery(id);
    setQuote((prev) => ({ ...prev, abandonedCartId: id }));
    setAbandonedCartRebuildLoading(true);
    setAbandonedCartError(null);
    setAbandonedCartMessage(null);
    try {
      const snapshotLines = normalizeAbandonedCartLines(quote.abandonedCartLines);
      const response = await fetch(`${getApiBase()}/quotes/abandoned-carts/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartId: id,
          lines: snapshotLines.length ? snapshotLines : undefined,
        }),
      });
      const data = (await response.json()) as {
        success?: boolean;
        cartId?: string;
        added?: Array<{ productCode: string }>;
        failed?: Array<{ productCode: string; error?: string }>;
        cartUrl?: string;
        sourceLines?: AbandonedCartLine[];
        usedSnapshot?: boolean;
        newCartId?: string | null;
        error?: string;
      };
      if (!response.ok && !(data.added && data.added.length > 0)) {
        const failedDetail = (data.failed ?? [])
          .map((row) => `${row.productCode}${row.error ? ` (${row.error})` : ""}`)
          .filter(Boolean)
          .join(", ");
        const summary = data?.error ?? "Failed to load cart into storefront";
        setAbandonedCartError(
          failedDetail && !summary.includes(failedDetail) ? `${summary} ${failedDetail}` : summary,
        );
        return;
      }
      if (data.cartUrl) {
        setLiveSessionUrl(data.cartUrl);
      }
      const sourceLines = normalizeAbandonedCartLines(data.sourceLines);
      if (sourceLines.length) {
        rememberAbandonedCartLines(sourceLines);
      }
      if (data.newCartId && isAbandonedCartGuid(data.newCartId)) {
        // ClearCart creates a new live GUID — point the quote at that cart.
        setAbandonedCartQuery(data.newCartId);
        setQuote((prev) => ({
          ...prev,
          abandonedCartId: data.newCartId!,
          abandonedCartLines: sourceLines.length
            ? sourceLines
            : (prev.abandonedCartLines ?? null),
        }));
        // Refresh snapshot from the new GUID while it still exists in CartIDLog.
        void snapshotAbandonedCartFromAdmin(data.newCartId);
      }
      const addedCount = data.added?.length ?? 0;
      const failedCount = data.failed?.length ?? 0;
      const failedDetail =
        failedCount > 0
          ? ` Failed: ${(data.failed ?? [])
              .map((row) => `${row.productCode}${row.error ? ` (${row.error})` : ""}`)
              .join(", ")}.`
          : "";
      const snapshotNote = data.usedSnapshot ? " (from saved snapshot)" : "";
      setAbandonedCartMessage(
        `Loaded ${addedCount} product(s) into the storefront cart${snapshotNote}.${failedDetail} Open the cart to choose shipping.`,
      );
    } catch {
      setAbandonedCartError("Failed to load cart into storefront");
    } finally {
      setAbandonedCartRebuildLoading(false);
    }
  };

  const searchOrLoadAbandonedCart = async () => {
    const value = abandonedCartQuery.trim();
    setAbandonedCartError(null);
    setAbandonedCartMessage(null);
    setAbandonedCartSearchResults([]);

    if (!value) {
      setAbandonedCartError("Enter a cart GUID or customer email");
      return;
    }

    if (looksLikeCartId(value)) {
      if (!liveSessionUrl) {
        setAbandonedCartError('Open Live Website Session first, then use "Load into cart"');
        return;
      }
      await rebuildAbandonedCart(value);
      return;
    }

    if (!looksLikeEmail(value)) {
      setAbandonedCartError("Enter a valid cart GUID or email address");
      return;
    }

    setAbandonedCartSearchLoading(true);
    try {
      const response = await fetch(`${getApiBase()}/quotes/abandoned-carts/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const data = (await response.json()) as { carts?: AbandonedCartSummary[]; error?: string };
      if (!response.ok) {
        setAbandonedCartError(data?.error ?? "Search failed");
        return;
      }
      const carts = Array.isArray(data.carts) ? data.carts : [];
      setAbandonedCartSearchResults(carts);
      if (!carts.length) {
        setAbandonedCartMessage("No abandoned/live carts found for that email");
      }
    } catch {
      setAbandonedCartError("Search failed");
    } finally {
      setAbandonedCartSearchLoading(false);
    }
  };

  const quoteNumberExists = async (quoteNum: string): Promise<boolean> => {
    const response = await fetch(`${getApiBase()}/api/quotes/search?q=${encodeURIComponent(quoteNum)}`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const isJson = contentType.includes("application/json");
    const parsedBody = isJson
      ? ((await response.json()) as { data?: QuoteSearchResult[]; offline?: boolean })
      : null;

    if (!response.ok || !parsedBody) {
      throw new Error("Could not check whether quote number exists");
    }
    if (parsedBody.offline) {
      throw new Error("Database is unavailable — cannot create quote.");
    }

    const target = quoteNum.toLowerCase();
    const results = Array.isArray(parsedBody.data) ? parsedBody.data : [];
    return results.some((row) => normalizeQuoteNumber(row.quoteNumber).toLowerCase() === target);
  };

  const buildSavePayload = (options?: { forceNewQuote?: boolean; quoteNumber?: string }) => {
    return {
      quote_number: (options?.quoteNumber ?? quote.quoteNumber).trim(),
      quote_date: quoteDateToInputValue(quote.quoteDate),
      status: "saved",
      version: appVersion,
      customer_name: quote.customerName ?? null,
      company: quote.customerCompany ?? null,
      email: quote.customerEmail ?? null,
      phone: quote.customerPhone ?? null,
      address: quote.customerAddress ?? null,
      customer_id: quote.customerId?.trim() || null,
      delivery_deadline: quote.deliveryDeadline?.trim() || null,
      art_deadline: quote.artDeadline?.trim() || null,
      notes: quote.notes ?? null,
      internal_notes: quote.internalNotes ?? null,
      estimate_valid_days: normalizeEstimateValidDays(quote.estimateValidDays),
      sales_contact: normalizeSalesContact(quote.salesContact),
      abandoned_cart_id: quote.abandonedCartId?.trim() || null,
      abandoned_cart_lines_json: normalizeAbandonedCartLines(quote.abandonedCartLines).length
        ? normalizeAbandonedCartLines(quote.abandonedCartLines)
        : null,
      internal_attachments_json: normalizeInternalAttachments(quote.internalAttachments),
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
      items: mapQuoteItemsForCreate(quote.items),
    };
  };

  const runSaveRequest = async (
    method: "POST" | "PUT",
    url: string,
    successMessage: string,
    options?: { forceNewQuote?: boolean; quoteNumber?: string },
  ) => {
    setSaveQuoteLoading(true);
    setSaveQuoteSuccess(null);
    setSaveQuoteError(null);

    const payload = buildSavePayload(options);
    console.log("[saveQuote] request:", { method, url, quoteNumber: payload.quote_number, loadedQuoteId });

    try {
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

      console.log("[saveQuote] response:", { method, status: response.status, body: parsedBody });

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
          setOriginalLoadedQuoteNumber(payload.quote_number || null);
          setQuote((prev) => ({
            ...prev,
            id: nextId,
            quoteNumber: payload.quote_number,
            status: "saved",
            version: appVersion,
          }));
        } else {
          setQuote((prev) => ({
            ...prev,
            status: "saved",
            version: appVersion,
          }));
        }
      } else {
        setQuote((prev) => ({
          ...prev,
          status: "saved",
          version: appVersion,
        }));
      }

      setSaveQuoteSuccess(successMessage);
    } catch (error) {
      console.error("[saveQuote] failed:", error);
      setSaveQuoteError(error instanceof Error ? error.message : "Failed to save quote");
    } finally {
      setSaveQuoteLoading(false);
    }
  };

  const createNewQuote = async () => {
    if (!quote.items.length) {
      setSaveQuoteError("Add at least one line item before saving.");
      return;
    }
    const quoteNum = normalizeQuoteNumber(quote.quoteNumber);
    let quoteNumberForSave = quoteNum;
    if (
      loadedQuoteId &&
      quoteNum.toLowerCase() === normalizeQuoteNumber(originalLoadedQuoteNumber).toLowerCase()
    ) {
      const nextQuoteNumber = await assignNextQuoteNumber({ force: true });
      if (!nextQuoteNumber) {
        setSaveQuoteError("Could not assign the next quote number for the copy.");
        return;
      }
      quoteNumberForSave = nextQuoteNumber;
    }
    if (!quoteNumberForSave) {
      setSaveQuoteError("Enter a quote number first.");
      return;
    }

    setSaveQuoteLoading(true);
    setSaveQuoteSuccess(null);
    setSaveQuoteError(null);
    try {
      const exists = await quoteNumberExists(quoteNumberForSave);
      if (exists) {
        setSaveQuoteError(`Quote "${quoteNumberForSave}" already exists. Choose a different quote number.`);
        return;
      }
    } catch (error) {
      console.error("[createNewQuote] failed:", error);
      setSaveQuoteError(error instanceof Error ? error.message : "Failed to create quote");
      return;
    } finally {
      setSaveQuoteLoading(false);
    }

    await runSaveRequest(
      "POST",
      `${getApiBase()}/api/quotes`,
      `New quote ${quoteNumberForSave} created.`,
      { forceNewQuote: true, quoteNumber: quoteNumberForSave },
    );
  };

  const saveQuote = async () => {
    if (!quote.items.length) {
      setSaveQuoteError("Add at least one line item before saving.");
      return;
    }
    const quoteNum = normalizeQuoteNumber(quote.quoteNumber);
    if (!quoteNum) {
      setSaveQuoteError("Enter a quote number first.");
      return;
    }

    if (loadedQuoteId) {
      const result = await Swal.fire({
        title: "Save changes?",
        text: `Save changes to quote "${quoteNum}"?`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, save quote",
        cancelButtonText: "Cancel",
        reverseButtons: true,
      });
      if (!result.isConfirmed) return;

      await runSaveRequest(
        "PUT",
        `${getApiBase()}/api/quotes/${encodeURIComponent(loadedQuoteId)}`,
        `Quote ${quoteNum} saved.`,
      );
      return;
    }

    await runSaveRequest("POST", `${getApiBase()}/api/quotes`, `Quote ${quoteNum} saved.`, {
      forceNewQuote: true,
    });
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
        const response = await fetch(`${getApiBase()}/api/quotes/search?q=${encodeURIComponent(q)}`);
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
      const response = await fetch(`${getApiBase()}/api/quotes/${encodeURIComponent(quoteId)}`);
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
      const items = (Array.isArray(data.items) ? data.items : []).map((item, index) =>
        deserializeQuoteItemFromDb(item, index, data.id, now),
      );

      const loadedShippingTotal = asNumber(data.shipping);
      const loadedShippingOptions = parseShippingOptionsFromDb(
        data.shippingOptionsJson ?? data.shipping_options_json,
      );

      const draft: Quote = {
        id: data.id,
        quoteNumber: readApiQuoteNumber(data),
        status: "saved",
        version: String(data.version ?? "1"),
        customerName: data.customerName ?? null,
        customerCompany: data.company ?? null,
        customerEmail: data.email ?? null,
        customerPhone: data.phone ?? null,
        customerAddress: data.address ?? null,
        customerId: data.customerId ?? data.customer_id ?? null,
        deliveryDeadline: data.deliveryDeadline ?? data.delivery_deadline ?? null,
        artDeadline: data.artDeadline ?? data.art_deadline ?? null,
        notes: data.notes ?? null,
        internalNotes: data.internalNotes ?? data.internal_notes ?? null,
        estimateValidDays: normalizeEstimateValidDays(
          data.estimateValidDays ?? data.estimate_valid_days,
        ),
        salesContact: normalizeSalesContact(data.salesContact ?? data.sales_contact),
        abandonedCartId:
          String(data.abandonedCartId ?? data.abandoned_cart_id ?? "").trim() || null,
        abandonedCartLines: (() => {
          const lines = normalizeAbandonedCartLines(
            data.abandonedCartLinesJson ??
              data.abandoned_cart_lines_json ??
              data.abandonedCartLines ??
              data.abandoned_cart_lines,
          );
          return lines.length ? lines : null;
        })(),
        internalAttachments: normalizeInternalAttachments(
          data.internalAttachmentsJson ?? data.internal_attachments_json,
        ),
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
        quoteDate: dbQuoteDateToQuoteDate(data.quoteDate),
      };

      const recalculated = recalcQuotePreservingTaxRate(draft, items, {
        shippingTotal: draft.shippingTotal,
        taxTotal: draft.taxTotal,
      });
      setQuote({ ...draft, ...recalculated });
      setEstimateValidDaysDraft(null);
      setLoadedQuoteId(data.id);
      setOriginalLoadedQuoteNumber(readApiQuoteNumber(data) || null);
      setAbandonedCartQuery(String(data.abandonedCartId ?? data.abandoned_cart_id ?? "").trim());
      setLineItemOptions({});
      setCalculatorTarget(null);
      setSearchQuery("");
      setSearchResults([]);
    } catch (error) {
      setSaveQuoteError(error instanceof Error ? error.message : "Failed to load quote");
    } finally {
      setLoadQuoteLoadingId(null);
    }
  };

  const startNewQuote = async () => {
    const result = await Swal.fire({
      title: "Start a new quote?",
      text: "This clears the current quote from this browser.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, start new quote",
      cancelButtonText: "Cancel",
      reverseButtons: true,
    });
    if (!result.isConfirmed) return;
    clearQuoteDraft();
    setLastCartPayload(null);
    setLoadedQuoteId(null);
    setOriginalLoadedQuoteNumber(null);
    setCalculatorTarget(null);
    setEstimateValidDaysDraft(null);
    setTaxPercentDraft(null);
    setShippingDestinationDraft(null);
    setTaxRowLabelDraft(null);
    setTaxAmountDraft(null);
    setShippingAmountDraft(null);
    setAbandonedCartQuery("");
    setAbandonedCartSearchResults([]);
    setAbandonedCartMessage(null);
    setAbandonedCartError(null);
    setLineItemOptions({});
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setSaveQuoteSuccess(null);
    setSaveQuoteError(null);
    setQuoteNumberNotice(null);
    setIdentifiedEmail(null);
    setLiveSessionUrl(null);
    setClearCartMessage(null);
    setClearCartError(null);
    setCustomImageTargetId(null);
    setQuote(createEmptyQuote());
    void assignNextQuoteNumber({ force: true });
  };

  const calculatorItem = calculatorTarget
    ? quote.items.find((item) => item.id === calculatorTarget.itemId)
    : undefined;
  const calculatorOpen = Boolean(calculatorTarget && calculatorItem);
  const calculatorInitialValue = calculatorItem
    ? calculatorTarget?.field === "discountValue"
      ? calculatorItem.discountValue
      : calculatorItem.unitPrice
    : 0;

  return (
    <main className={`container${calculatorOpen ? " quote-builder-container-with-calc" : ""}`}>
      {scrapeCartServerLoading || abandonedCartRebuildLoading ? (
        <div
          className="quote-builder-scrape-overlay"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="quote-builder-scrape-panel">
            <div className="quote-builder-scrape-spinner" aria-hidden />
            <div style={{ fontSize: 16, fontWeight: 600, color: "#0f172a" }}>
              {abandonedCartRebuildLoading ? "Loading into cart…" : "Reading live cart…"}
            </div>
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>
              {abandonedCartRebuildLoading
                ? "Clearing the storefront cart and adding products with their options. The cart page will open when this finishes."
                : "Please wait while product options are loaded from the storefront. This can take a few seconds."}
            </div>
          </div>
        </div>
      ) : null}
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
            .quote-builder-scrape-overlay {
              position: fixed;
              inset: 0;
              z-index: 9999;
              display: flex;
              align-items: center;
              justify-content: center;
              background: rgba(15, 23, 42, 0.45);
              backdrop-filter: blur(2px);
            }
            .quote-builder-scrape-panel {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 14px;
              min-width: 260px;
              max-width: min(90vw, 360px);
              padding: 28px 32px;
              border-radius: 12px;
              background: #ffffff;
              box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
              text-align: center;
            }
            .quote-builder-scrape-spinner {
              width: 40px;
              height: 40px;
              border: 3px solid #dbeafe;
              border-top-color: #1d4ed8;
              border-radius: 50%;
              animation: quote-builder-identify-spin 0.7s linear infinite;
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
            <button type="button" className="btn" onClick={startNewQuote}>
              New Quote
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
            placeholder="Search by quote #, customer, company, email, file name, or screenshot text"
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
                    {formatCustomerInfoBlock({
                      customerName: result.customerName,
                      customerCompany: result.company,
                      customerEmail: result.email,
                      customerPhone: null,
                      customerAddress: null,
                    })
                      .split("\n")
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(" · ") || "—"}
                  </div>
                  {result.attachmentHits && result.attachmentHits.length > 0 ? (
                    <div
                      className="muted"
                      style={{
                        marginTop: 4,
                        fontSize: 11,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {result.attachmentHits.map((hit) =>
                        hit.url ? (
                          <img
                            key={`${result.id}-${hit.fileName}`}
                            src={hit.url}
                            alt=""
                            title={hit.fileName}
                            style={{
                              width: 28,
                              height: 28,
                              objectFit: "cover",
                              borderRadius: 4,
                              border: "1px solid #e5e7eb",
                              background: "#fff",
                            }}
                          />
                        ) : (
                          <span key={`${result.id}-${hit.fileName}`}>{hit.fileName}</span>
                        ),
                      )}
                    </div>
                  ) : null}
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
        <div className="section">
          <div style={{ maxWidth: 280, marginBottom: 14 }}>
            <label htmlFor="sales-contact">Sales Contact:</label>
            <select
              id="sales-contact"
              value={quote.salesContact ?? ""}
              onChange={(e) =>
                setQuote((prev) => ({
                  ...prev,
                  salesContact: normalizeSalesContact(e.target.value),
                }))
              }
              style={{
                width: "100%",
                marginTop: 6,
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 14,
                font: "inherit",
                background: "#fff",
                color: "#1f2937",
                cursor: "pointer",
              }}
            >
              <option value="">Select</option>
              {SALES_CONTACTS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid-4">
          <div>
            <label>Quote #</label>
            <input
              value={quote.quoteNumber}
              onChange={(e) => setQuote((prev) => ({ ...prev, quoteNumber: e.target.value }))}
              placeholder="Q0001"
            />
            {quoteNumberNotice ? (
              <div style={{ marginTop: 4, fontSize: 12, color: "#b91c1c" }}>{quoteNumberNotice}</div>
            ) : null}
            {loadedQuoteId && originalLoadedQuoteNumber ? (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                Loaded quote: {originalLoadedQuoteNumber}. Change Quote # and click Create new quote to save a
                copy; click Save Quote to update the loaded quote.
              </div>
            ) : null}
          </div>
          <div>
            <label>Date</label>
            <input
              type="date"
              value={quoteDateToInputValue(quote.quoteDate)}
              onChange={(e) =>
                setQuote((prev) => ({
                  ...prev,
                  quoteDate: inputValueToQuoteDate(e.target.value),
                }))
              }
            />
          </div>
          <div>
            <label>Status</label>
            <input value={loadedQuoteId ? "saved" : quote.status} readOnly />
          </div>
          <div>
            <label>Version</label>
            <input value={`v${appVersion}`} readOnly />
          </div>
          </div>
        </div>

        <div className="section">
          <h2 style={{ marginTop: 0 }}>Customer Info</h2>
          <label htmlFor="customer-info-block">Paste customer details</label>
          <textarea
            id="customer-info-block"
            value={formatCustomerInfoBlock(quote)}
            onChange={(e) =>
              setQuote((prev) => ({
                ...prev,
                ...customerInfoFromPaste(e.target.value),
              }))
            }
            placeholder={[
              "Medvantx",
              "Julie Morrell",
              "4005 Carmel View Road Unit 69",
              "San Diego, CA 92130",
              "United States",
              "(919) 699-3466",
              "Julie.Morrell@medvantx.com",
            ].join("\n")}
            style={{
              marginTop: 8,
              width: "100%",
              minHeight: 160,
              border: "1px solid #d1d5db",
              borderRadius: 6,
              padding: "10px 12px",
              font: "inherit",
              lineHeight: 1.45,
              resize: "vertical",
              background: "#fff",
              whiteSpace: "pre-wrap",
              textAlign: "left",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <div>
              <label htmlFor="customer-id">Customer ID</label>
              <input
                id="customer-id"
                value={quote.customerId ?? ""}
                onChange={(e) =>
                  setQuote((prev) => ({
                    ...prev,
                    customerId: e.target.value || null,
                  }))
                }
                placeholder="Customer ID"
                style={{ marginTop: 6 }}
              />
            </div>
            <div>
              <label htmlFor="delivery-deadline">Delivery Deadline</label>
              <input
                id="delivery-deadline"
                value={quote.deliveryDeadline ?? ""}
                onChange={(e) =>
                  setQuote((prev) => ({
                    ...prev,
                    deliveryDeadline: e.target.value || null,
                  }))
                }
                placeholder="Delivery Deadline"
                style={{ marginTop: 6 }}
              />
            </div>
            <div>
              <label htmlFor="art-deadline">Art Deadline</label>
              <input
                id="art-deadline"
                value={quote.artDeadline ?? ""}
                onChange={(e) =>
                  setQuote((prev) => ({
                    ...prev,
                    artDeadline: e.target.value || null,
                  }))
                }
                placeholder="Art Deadline"
                style={{ marginTop: 6 }}
              />
            </div>
          </div>
        </div>

        <div className={`quote-builder-work-area${calculatorOpen ? " quote-builder-work-area-with-calc" : ""}`}>
          <div className="quote-builder-work-main">
        <div className="section">
          <h2 style={{ marginTop: 0 }}>Product images</h2>
          <QuoteLineItemImageGallery
            items={quote.items}
            variant="builder"
            onRemoveImage={removeItemImage}
          />
        </div>

        <div className="section">
          <h2 style={{ marginTop: 0 }}>Line Items</h2>
          <table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Stock #</th>
                <th>Description</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 148 }}>Unit Price</th>
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
                          disabled={
                            !(
                              item.availableOptions?.length ||
                              (lastCartPayload && lastCartPayload.cartItems.length)
                            )
                          }
                        >
                          {lineItemOptions[item.id]?.loading
                            ? "Loading..."
                            : lineItemOptions[item.id]?.expanded
                              ? "Hide Options"
                              : "Get Options"}
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
                                {!isQuoteDiscountLine(item) ? (
                                  <span
                                    style={{
                                      position: "relative",
                                      display: "inline-block",
                                      marginTop: 8,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="btn"
                                      style={{ padding: "6px 10px", paddingRight: 22 }}
                                      onClick={() => openCustomImagePicker(item.id)}
                                    >
                                      Add custom img
                                    </button>
                                    <span
                                      className="add-custom-img-help"
                                      title="Add custom images to this product. New images are added alongside the existing product photo - remove any image with x in the gallery."
                                      aria-label="Help: add custom images to this product"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      ?
                                      <span className="add-custom-img-help-tip" role="tooltip">
                                        Add custom images to this product. Uploads are added alongside the
                                        existing product photo — remove any image yourself with × in the
                                        gallery.
                                      </span>
                                    </span>
                                  </span>
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
                          <div className="unit-price-calc-wrap">
                            <input
                              type="number"
                              className="no-spinner"
                              min={0}
                              step={item.discountType === "percent" ? "0.01" : "any"}
                              value={item.discountValue}
                              placeholder={item.discountType === "percent" ? "e.g. 10" : "e.g. 50"}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                updateItem(index, { discountValue: Number.isFinite(n) ? Math.max(0, n) : 0 });
                              }}
                            />
                            <PriceCalculatorTrigger
                              active={
                                calculatorTarget?.itemId === item.id &&
                                calculatorTarget.field === "discountValue"
                              }
                              onClick={() => togglePriceCalculator(item.id, "discountValue")}
                              label={`Open calculator for ${item.name || "discount"}`}
                            />
                          </div>
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
                          <div className="unit-price-calc-wrap">
                            <input
                              type="number"
                              className="no-spinner"
                              step={item.lineType === "custom" ? "any" : undefined}
                              min={item.lineType === "custom" ? undefined : 0}
                              value={item.unitPrice}
                              placeholder={item.lineType === "custom" ? "e.g. -50 for credit" : undefined}
                              title={
                                item.lineType === "custom"
                                  ? "Negative unit price or qty reduces the quote total (credit line)"
                                  : undefined
                              }
                              onKeyDown={(e) => {
                                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                  e.preventDefault();
                                }
                              }}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                updateItem(index, { unitPrice: Number.isFinite(n) ? n : 0 });
                              }}
                            />
                            <PriceCalculatorTrigger
                              active={
                                calculatorTarget?.itemId === item.id &&
                                calculatorTarget.field === "unitPrice"
                              }
                              onClick={() => togglePriceCalculator(item.id, "unitPrice")}
                              label={`Open calculator for ${item.name || "unit price"}`}
                            />
                          </div>
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
                  !liveSessionUrl ||
                  scrapeCartServerLoading ||
                  openCartSessionLoading ||
                  openLiveCartLoading ||
                  identifyLoading ||
                  abandonedCartRebuildLoading
                }
                title={
                  !liveSessionUrl ? "Open Live Website Session first" : undefined
                }
              >
                {scrapeCartServerLoading ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span className="quote-builder-identify-spinner" aria-hidden />
                    Reading live cart…
                  </span>
                ) : (
                  "Add Products From Cart"
                )}
              </button>
              <button
                type="button"
                className="btn"
                onClick={clearStorefrontCart}
                disabled={
                  !liveSessionUrl ||
                  clearCartLoading ||
                  scrapeCartServerLoading ||
                  openCartSessionLoading ||
                  openLiveCartLoading ||
                  identifyLoading ||
                  abandonedCartRebuildLoading
                }
                title={!liveSessionUrl ? "Open Live Website Session first" : undefined}
                style={{ marginLeft: 8 }}
              >
                {clearCartLoading ? "Clearing cart..." : "Clear Cart"}
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const id = (quote.abandonedCartId || abandonedCartQuery).trim();
                    if (!id) {
                      setAbandonedCartError("No abandoned cart ID on this quote");
                      return;
                    }
                    void rebuildAbandonedCart(id);
                  }}
                  disabled={
                    abandonedCartRebuildLoading ||
                    !liveSessionUrl ||
                    !(quote.abandonedCartId || abandonedCartQuery).trim()
                  }
                  title={
                    !liveSessionUrl
                      ? "Open Live Website Session first"
                      : !(quote.abandonedCartId || abandonedCartQuery).trim()
                        ? "No abandoned cart ID on this quote"
                        : undefined
                  }
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  {abandonedCartRebuildLoading ? (
                    <>
                      <span className="quote-builder-identify-spinner" aria-hidden />
                      Loading into cart…
                    </>
                  ) : (
                    "Load into cart"
                  )}
                </button>
                <label
                  className="muted"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}
                >
                  <input
                    type="checkbox"
                    checked={showAbandonedCartDevTools}
                    onChange={(e) => setShowAbandonedCartDevTools(e.target.checked)}
                  />
                  Dev tools
                </label>
              </div>
              {!liveSessionUrl ? (
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Open Live Website Session before loading a cart into the storefront.
                </div>
              ) : null}
              {showAbandonedCartDevTools ? (
                <>
                  <label
                    className="muted"
                    style={{ display: "block", fontSize: 13, marginTop: 10, marginBottom: 6 }}
                  >
                    Load abandoned / live cart (GUID or email)
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      value={abandonedCartQuery}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAbandonedCartQuery(value);
                        const trimmed = value.trim();
                        setQuote((prev) => ({
                          ...prev,
                          abandonedCartId: looksLikeCartId(trimmed)
                            ? trimmed
                            : (prev.abandonedCartId ?? null),
                        }));
                      }}
                      placeholder="Cart GUID or customer email"
                      disabled={abandonedCartSearchLoading || abandonedCartRebuildLoading}
                      style={{
                        minWidth: 280,
                        flex: "1 1 240px",
                        padding: "8px 10px",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void searchOrLoadAbandonedCart();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void searchOrLoadAbandonedCart()}
                      disabled={
                        abandonedCartSearchLoading ||
                        abandonedCartRebuildLoading ||
                        (!looksLikeEmail(abandonedCartQuery.trim()) && !liveSessionUrl)
                      }
                      aria-disabled={
                        abandonedCartSearchLoading ||
                        abandonedCartRebuildLoading ||
                        (!looksLikeEmail(abandonedCartQuery.trim()) && !liveSessionUrl)
                          ? true
                          : undefined
                      }
                      title={
                        !looksLikeEmail(abandonedCartQuery.trim()) && !liveSessionUrl
                          ? "Open Live Website Session first"
                          : undefined
                      }
                      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                    >
                      {abandonedCartRebuildLoading ? (
                        <>
                          <span className="quote-builder-identify-spinner" aria-hidden />
                          Loading into cart…
                        </>
                      ) : abandonedCartSearchLoading ? (
                        <>
                          <span className="quote-builder-identify-spinner" aria-hidden />
                          Searching…
                        </>
                      ) : looksLikeEmail(abandonedCartQuery.trim()) ? (
                        "Search carts"
                      ) : (
                        "Load into cart"
                      )}
                    </button>
                  </div>
                  {abandonedCartSearchResults.length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        maxHeight: 220,
                        overflow: "auto",
                      }}
                    >
                      {abandonedCartSearchResults.map((cart) => (
                        <button
                          key={cart.cartId}
                          type="button"
                          onClick={() => void rebuildAbandonedCart(cart.cartId)}
                          disabled={abandonedCartRebuildLoading || !liveSessionUrl}
                          title={!liveSessionUrl ? "Open Live Website Session first" : undefined}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderBottom: "1px solid #f1f5f9",
                            background: "transparent",
                            cursor:
                              abandonedCartRebuildLoading || !liveSessionUrl
                                ? "default"
                                : "pointer",
                            opacity: !liveSessionUrl ? 0.55 : 1,
                          }}
                        >
                          <div style={{ fontFamily: "monospace", fontSize: 12 }}>{cart.cartId}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[
                              cart.itemCount != null ? `${cart.itemCount} item(s)` : null,
                              cart.lastModified,
                              cart.email,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
              {abandonedCartMessage ? (
                <div className="muted" style={{ marginTop: 8, fontSize: 12, color: "var(--success, #0a7a2f)" }}>
                  {abandonedCartMessage}
                </div>
              ) : null}
              {abandonedCartError ? (
                <div className="muted" style={{ marginTop: 8, fontSize: 12, color: "var(--danger, #b42318)" }}>
                  {abandonedCartError}
                </div>
              ) : null}
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
          </div>
          {calculatorOpen && calculatorTarget && calculatorItem ? (
            <div id="quote-calculator-panel">
              <QuoteCalculator
                key={`${calculatorTarget.itemId}-${calculatorTarget.field}`}
                initialExpression={String(calculatorInitialValue)}
                applyLabel={
                  calculatorTarget.field === "discountValue" ? "Use this discount" : "Use this price"
                }
                onApply={applyCalculatorValue}
                onClose={() => setCalculatorTarget(null)}
              />
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
            <label htmlFor="quote-internal-notes-builder">Internal notes</label>
            <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
              For staff only. Not included on the estimate, PDF, or Excel.
            </div>
            <textarea
              id="quote-internal-notes-builder"
              value={quote.internalNotes ?? ""}
              onChange={(e) => setQuote((prev) => ({ ...prev, internalNotes: e.target.value }))}
              placeholder="Add notes for your team"
              style={{
                marginTop: 8,
                width: "100%",
                minHeight: 88,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "10px 12px",
                font: "inherit",
                resize: "vertical",
                background: "#fff",
              }}
            />
            <label htmlFor="quote-notes-builder" style={{ marginTop: 14 }}>
              Notes
            </label>
            <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
              Shown on the estimate, PDF, and Excel.
            </div>
            <textarea
              id="quote-notes-builder"
              value={quote.notes ?? ""}
              onChange={(e) => setQuote((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Add notes for the customer"
              style={{
                marginTop: 8,
                width: "100%",
                minHeight: 88,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "10px 12px",
                font: "inherit",
                resize: "vertical",
                background: "#fff",
              }}
            />
            <QuoteInternalAttachments
              attachments={quote.internalAttachments ?? []}
              onChange={(internalAttachments) =>
                setQuote((prev) => ({ ...prev, internalAttachments }))
              }
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
                flexDirection: "column",
                alignItems: "stretch",
                gap: 8,
              }}
            >
              <div
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
                value={selectedShippingMethodValue}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setQuote((prev) => {
                    const cartOption = findCartShippingOption(prev.shippingOptions, nextValue);
                    const nextShippingTotal = isTbdLabel(prev.shippingLabel)
                      ? 0
                      : cartOption?.price != null && cartOption.price > 0
                        ? cartOption.price
                        : prev.shippingTotal;
                    const shippingMethod =
                      nextValue === CUSTOM_SHIPPING_METHOD_VALUE
                        ? isCustomShippingMethod(prev.shippingMethod)
                          ? (prev.shippingMethod ?? CUSTOM_SHIPPING_METHOD_VALUE)
                          : CUSTOM_SHIPPING_METHOD_VALUE
                        : nextValue;
                    return {
                      ...prev,
                      shippingMethod,
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
              {customShippingSelected ? (
                <input
                  type="text"
                  aria-label="Custom shipping method"
                  placeholder="Custom shipping method"
                  value={customShippingMethodText(quote.shippingMethod)}
                  onChange={(e) => {
                    const text = e.target.value;
                    setQuote((prev) => ({
                      ...prev,
                      shippingMethod: withCustomShippingText(text),
                    }));
                  }}
                />
              ) : null}
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
        <div className="section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label
            htmlFor="estimate-valid-days"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: 0, color: "#475569", fontSize: 14 }}
          >
            Estimate Valid For
            <input
              id="estimate-valid-days"
              type="text"
              inputMode="numeric"
              aria-label="Estimate valid for days"
              value={estimateValidDaysDraft ?? String(normalizeEstimateValidDays(quote.estimateValidDays))}
              onFocus={() => setEstimateValidDaysDraft(String(normalizeEstimateValidDays(quote.estimateValidDays)))}
              onBlur={() => {
                if (estimateValidDaysDraft !== null) {
                  const parsed = Number(estimateValidDaysDraft.trim());
                  if (Number.isFinite(parsed) && parsed >= 1) {
                    setQuote((prev) => ({
                      ...prev,
                      estimateValidDays: normalizeEstimateValidDays(parsed),
                    }));
                  }
                }
                setEstimateValidDaysDraft(null);
              }}
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                setEstimateValidDaysDraft(next);
                if (next) {
                  setQuote((prev) => ({
                    ...prev,
                    estimateValidDays: normalizeEstimateValidDays(next),
                  }));
                }
              }}
              style={{
                width: 64,
                textAlign: "center",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "6px 8px",
                font: "inherit",
                background: "#fff",
                color: "#1f2937",
              }}
            />
            {normalizeEstimateValidDays(
              estimateValidDaysDraft && Number(estimateValidDaysDraft) >= 1
                ? estimateValidDaysDraft
                : quote.estimateValidDays,
            ) === 1
              ? "Day"
              : "Days"}
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginLeft: "auto" }}>
          {saveQuoteSuccess ? <span style={{ color: "#166534", fontWeight: 600 }}>{saveQuoteSuccess}</span> : null}
          {saveQuoteError ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>{saveQuoteError}</span> : null}
          {loadedQuoteId ? (
            <button
              type="button"
              className="btn"
              onClick={() => void createNewQuote()}
              disabled={saveQuoteLoading || !canSaveQuote}
              title={!canSaveQuote ? "Add at least one line item before saving" : undefined}
            >
              {saveQuoteLoading ? "Saving..." : "Duplicate and Save"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn primary"
            onClick={() => void saveQuote()}
            disabled={saveQuoteLoading || !canSaveQuote}
            title={!canSaveQuote ? "Add at least one line item before saving" : undefined}
          >
            {saveQuoteLoading ? "Saving..." : "SAVE QUOTE"}
          </button>
          </div>
        </div>
      </div>
    </main>
  );
}

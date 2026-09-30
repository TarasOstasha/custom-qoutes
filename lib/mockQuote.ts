import type { CartShippingOption } from "./extractCartFromPage";
import type { QuoteInternalAttachment } from "./quoteAttachments";

export type QuoteItem = {
  id: string;
  quoteId: string;
  lineType: "product" | "custom";
  sourceProductId?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  /** Additional uploaded images shown in the product gallery (kept alongside imageUrl). */
  extraImageUrls?: string[] | null;
  name: string;
  description?: string | null;
  /** Cart/product options the user checked in the builder; included on PDF export. */
  chosenOptions?: string[] | null;
  /** Options available from the cart popup (`.vol-chosen-options-list`) for Get Options checkboxes. */
  availableOptions?: string[] | null;
  /** Stable Volusion cart row identity — keeps duplicate SKUs as separate lines. */
  importLineId?: string | null;
  qty: number;
  unitPrice: number;
  discountType: "none" | "amount" | "percent";
  discountValue: number;
  /** `$` or `%` discount applied to quote merchandise subtotal (Add Discount lines). */
  discountScope?: "quote" | null;
  sortOrder: number;
  lineSubtotal: number;
  lineDiscountTotal: number;
  lineTotal: number;
  createdAt: string;
  updatedAt: string;
};

export type Quote = {
  id: string;
  quoteNumber: string;
  status: "draft" | "final";
  version: number;
  customerName?: string | null;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  notes?: string | null;
  /** Staff-only notes. Never included on the estimate, PDF, or Excel. */
  internalNotes?: string | null;
  /** Internal files/screenshots for staff use only — never included in PDF/Excel export. */
  internalAttachments?: QuoteInternalAttachment[] | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  shippingLabel?: string | null;
  /** Builder shipping method select value (e.g. "1" = Ground, or cart value "928"). */
  shippingMethod?: string | null;
  /** Volusion cart shipping options appended to the builder dropdown. */
  shippingOptions?: CartShippingOption[] | null;
  shippingState?: string | null;
  shippingZip?: string | null;
  taxTotal: number;
  taxLabel?: string | null;
  /** Raw cart tax label from `.v65-cart-taxtext-cell b` (replaces "Tax" in totals). */
  taxDescription?: string | null;
  /** Cart / manual sales tax rate (e.g. 9.5). Tax $ is derived from this when set. */
  taxRatePercent?: number | null;
  grandTotal: number;
  items: QuoteItem[];
  createdAt: string;
  updatedAt: string;
  quoteDate: string;
  /** How many days the printed estimate stays valid. Defaults to 30. */
  estimateValidDays?: number | null;
  /** Staff member shown on the PDF as the sales contact. */
  salesContact?: string | null;
};

export const SALES_CONTACTS = ["Manny", "Yelena", "Nikita", "Alex", "Yulia"] as const;

export function normalizeSalesContact(value: unknown): string | null {
  const name = String(value ?? "").trim();
  return (SALES_CONTACTS as readonly string[]).includes(name) ? name : null;
}

export const DEFAULT_ESTIMATE_VALID_DAYS = 30;

export function normalizeEstimateValidDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return DEFAULT_ESTIMATE_VALID_DAYS;
  const days = Math.round(n);
  if (days < 1) return DEFAULT_ESTIMATE_VALID_DAYS;
  return Math.min(days, 9999);
}

export function formatEstimateValidLabel(days: number | null | undefined): string {
  const n = normalizeEstimateValidDays(days);
  return `Estimate Valid For ${n} ${n === 1 ? "Day" : "Days"}`;
}

const now = new Date().toISOString();

export const mockQuote: Quote = {
  id: "q_demo_1",
  quoteNumber: "EX260127A",
  status: "draft",
  version: 1,
  customerName: "Melanie Day",
  customerCompany: "VOCO America, Inc.",
  customerEmail: "Melanie.Day@voco.com",
  customerPhone: "(973) 515-5151",
  customerAddress: "170 Changebridge Rd, Bldg A7\nMontville, NJ 07045",
  notes: "Estimate valid for 30 days",
  internalAttachments: [],
  subtotal: 2992.5,
  discountTotal: 607.5,
  shippingTotal: 346.32,
  shippingLabel: null,
  shippingMethod: null,
  shippingOptions: null,
  shippingState: null,
  shippingZip: null,
  taxTotal: 0,
  taxLabel: null,
  taxDescription: null,
  taxRatePercent: null,
  grandTotal: 2738.82,
  createdAt: now,
  updatedAt: now,
  quoteDate: "1/27/2026",
  items: [
    {
      id: "qi_demo_1",
      quoteId: "q_demo_1",
      lineType: "product",
      sourceProductId: "W505730",
      sku: "W505730",
      imageUrl:
        "https://www.xyzdisplays.com/v/vspfiles/photos/ws05800m-2T.jpg?v-cache=1772806861",
      name: "4ft Custom Printed Draped Table Runner",
      description: "Quantity / ACH Discount",
      qty: 25,
      unitPrice: 110,
      discountType: "amount",
      discountValue: 14.3,
      sortOrder: 1,
      lineSubtotal: 2750,
      lineDiscountTotal: 357.5,
      lineTotal: 2392.5,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qi_demo_2",
      quoteId: "q_demo_1",
      lineType: "product",
      sourceProductId: "W35141",
      sku: "W35141",
      imageUrl: null,
      name: "PMS Color Match",
      description: "Courtesy Discount",
      qty: 1,
      unitPrice: 70,
      discountType: "amount",
      discountValue: 70,
      sortOrder: 2,
      lineSubtotal: 70,
      lineDiscountTotal: 70,
      lineTotal: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "qi_demo_3",
      quoteId: "q_demo_1",
      lineType: "custom",
      sku: null,
      sourceProductId: null,
      imageUrl: null,
      name: "Shipping",
      description: "Ground Shipping to SC (Estimated)",
      qty: 1,
      unitPrice: 346.32,
      discountType: "none",
      discountValue: 0,
      sortOrder: 3,
      lineSubtotal: 346.32,
      lineDiscountTotal: 0,
      lineTotal: 346.32,
      createdAt: now,
      updatedAt: now,
    },
  ],
};

/** Fresh quote for builder / after clearing stored draft. */
export function createEmptyQuote(): Quote {
  const t = new Date().toISOString();
  const quoteDate = new Date().toLocaleDateString("en-US");
  return {
    id: "q_draft",
    quoteNumber: "",
    status: "draft",
    version: 1,
    customerName: null,
    customerCompany: null,
    customerEmail: null,
    customerPhone: null,
    customerAddress: null,
    notes: null,
    internalNotes: null,
    internalAttachments: [],
    estimateValidDays: DEFAULT_ESTIMATE_VALID_DAYS,
    salesContact: null,
    subtotal: 0,
    discountTotal: 0,
    shippingTotal: 0,
    shippingLabel: null,
    shippingMethod: "0",
    shippingOptions: null,
    shippingState: null,
    shippingZip: null,
    taxTotal: 0,
    taxLabel: null,
    taxDescription: null,
    taxRatePercent: null,
    grandTotal: 0,
    items: [],
    createdAt: t,
    updatedAt: t,
    quoteDate,
  };
}

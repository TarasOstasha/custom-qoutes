export interface QuoteItem {
  id: string;
  quoteId: string;
  lineType: "product" | "custom";
  sourceProductId?: string | null;
  sku?: string | null;
  imageUrl?: string | null;
  name: string;
  description?: string | null;
  qty: number;
  unitPrice: number;
  discountType: "none" | "amount" | "percent";
  discountValue: number;
  sortOrder: number;
  lineSubtotal: number;
  lineDiscountTotal: number;
  lineTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  status: "draft" | "final";
  version: number;
  customerName?: string | null;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  notes?: string | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  items: QuoteItem[];
  createdAt: string;
  updatedAt: string;
}

const now = new Date().toISOString();

export const quotes: Quote[] = [
  {
    id: "q_1",
    quoteNumber: "Q-20260323-0001",
    status: "draft",
    version: 1,
    customerName: "Alex Morgan",
    customerCompany: "North Expo Co.",
    customerEmail: "alex@northexpo.com",
    customerPhone: "555-0102",
    notes: "Internal sample quote",
    subtotal: 3650,
    discountTotal: 320,
    shippingTotal: 0,
    taxTotal: 0,
    grandTotal: 3330,
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: "qi_1",
        quoteId: "q_1",
        lineType: "custom",
        sourceProductId: null,
        sku: null,
        imageUrl: null,
        name: "10x20 Booth Package",
        description: "Backdrop + counters + lights",
        qty: 1,
        unitPrice: 3200,
        discountType: "percent",
        discountValue: 10,
        sortOrder: 1,
        lineSubtotal: 3200,
        lineDiscountTotal: 320,
        lineTotal: 2880,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "qi_2",
        quoteId: "q_1",
        lineType: "custom",
        sourceProductId: null,
        sku: null,
        imageUrl: null,
        name: "Shipping",
        description: null,
        qty: 1,
        unitPrice: 450,
        discountType: "none",
        discountValue: 0,
        sortOrder: 2,
        lineSubtotal: 450,
        lineDiscountTotal: 0,
        lineTotal: 450,
        createdAt: now,
        updatedAt: now,
      },
    ],
  },
];

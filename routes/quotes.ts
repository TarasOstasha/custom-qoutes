import { Router, Request, Response } from "express";
import { Quote, QuoteItem, quotes } from "../mock/quotes";
import { fetchCartProductsAsQuoteItems } from "../services/volusion";

const router = Router();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcLine(item: {
  qty: number;
  unitPrice: number;
  discountType: "none" | "amount" | "percent";
  discountValue: number;
}) {
  const lineSubtotal = round2(item.qty * item.unitPrice);
  let lineDiscountTotal = 0;

  if (item.discountType === "amount") {
    lineDiscountTotal = round2(item.discountValue);
  } else if (item.discountType === "percent") {
    lineDiscountTotal = round2((lineSubtotal * item.discountValue) / 100);
  }

  lineDiscountTotal = Math.min(lineDiscountTotal, lineSubtotal);
  const lineTotal = round2(lineSubtotal - lineDiscountTotal);

  return { lineSubtotal, lineDiscountTotal, lineTotal };
}

function calcQuoteTotals(items: QuoteItem[]) {
  const nonShippingItems = items.filter((i) => i.name !== "Shipping");
  const shippingItems = items.filter((i) => i.name === "Shipping");

  const subtotal = round2(nonShippingItems.reduce((sum, i) => sum + i.lineSubtotal, 0));
  const discountTotal = round2(nonShippingItems.reduce((sum, i) => sum + i.lineDiscountTotal, 0));
  const shippingTotal = round2(shippingItems.reduce((sum, i) => sum + i.lineTotal, 0));
  const taxTotal = 0;
  const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);
  return { subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}

router.get("/", (_req: Request, res: Response) => {
  res.json({ data: quotes });
});

router.get("/cart-products", async (req: Request, res: Response) => {
  try {
    const rawCodes = String(req.query.codes ?? "");
    
    const codes = rawCodes
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    
    if (!codes.length) {
      return res.json({ items: [] });
    }
    console.log(codes, 'rawCodes')
    const cartItems = codes.map((productCode) => ({ productCode, qty: 1 }));
    const items = await fetchCartProductsAsQuoteItems(cartItems);
    console.log(items, 'items')
    return res.json({ items });

  } catch (error) {
    return res.status(500).json({ error: "Failed to load cart products" });
  }
});

router.get("/:id", (req: Request, res: Response) => {
  console.log(req.query.codes, 'body')
  const quote = quotes.find((q) => q.id === req.params.id);
  console.log(quote, 'quote')
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  res.json(quote);
});

router.post("/", (req: Request, res: Response) => {
  const body = req.body as Quote;
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const items: QuoteItem[] = rawItems.map((item) => {
    const qty = Number(item.qty ?? 0);
    const unitPrice = Number(item.unitPrice ?? 0);
    const discountType = item.discountType ?? "none";
    const discountValue = Number(item.discountValue ?? 0);
    const line = calcLine({ qty, unitPrice, discountType, discountValue });

    return {
      ...item,
      qty,
      unitPrice,
      discountType,
      discountValue,
      lineSubtotal: line.lineSubtotal,
      lineDiscountTotal: line.lineDiscountTotal,
      lineTotal: line.lineTotal,
    };
  });

  const totals = calcQuoteTotals(items);

  const newQuote: Quote = {
    ...body,
    items,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    shippingTotal: totals.shippingTotal,
    taxTotal: totals.taxTotal,
    grandTotal: totals.grandTotal,
  };

  quotes.unshift(newQuote);
  res.status(201).json(newQuote);
});

export default router;

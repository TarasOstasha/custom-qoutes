import { Router, Request, Response } from "express";
import { recalcQuote } from "../lib/recalcQuote";
import { Quote, QuoteItem, quotes } from "../mock/quotes";
import { fetchCartProductsAsQuoteItems } from "../services/volusion";
import { identifyVolusionUser } from "../services/identifyUser";
import {
  closeVolusionStorefrontCartSession,
  openVolusionStorefrontCartSession,
  scrapeVolusionStorefrontCart,
} from "../services/scrapeStorefrontCart";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({ data: quotes });
});

// products
router.get("/products", async (req: Request, res: Response) => {
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
    const popupItems = codes.map((productCode) => ({ productCode, qty: 1 }));
    const items = await fetchCartProductsAsQuoteItems(popupItems);
    console.log(items, 'items')
    return res.json({ items });

  } catch (error) {
    return res.status(500).json({ error: "Failed to load products" });
  }
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

router.get("/image-proxy", async (req: Request, res: Response) => {
  try {
    const raw = String(req.query.url ?? "").trim();
    if (!raw) return res.status(400).json({ error: "Missing url" });

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return res.status(400).json({ error: "Invalid url" });
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return res.status(400).json({ error: "Unsupported protocol" });
    }

    const response = await fetch(target.toString());
    if (!response.ok) {
      return res.status(502).json({ error: "Failed to fetch image" });
    }

    const ct = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("image/")) {
      return res.status(415).json({ error: "URL is not an image" });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const dataUrl = `data:${ct};base64,${bytes.toString("base64")}`;
    return res.json({ dataUrl });
  } catch {
    return res.status(500).json({ error: "Image proxy failed" });
  }
});

router.post("/scrape-cart", async (req: Request, res: Response) => {
  try {
    const body = req.body as { cartUrl?: string } | undefined;
    const cartUrl = body?.cartUrl?.trim();
    const payload = await scrapeVolusionStorefrontCart({
      ...(cartUrl ? { cartUrl } : {}),
    });
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to scrape cart";
    return res.status(500).json({ error: message });
  }
});

router.post("/cart-session/open", async (req: Request, res: Response) => {
  try {
    const body = req.body as { cartUrl?: string } | undefined;
    const cartUrl = body?.cartUrl?.trim();
    const data = await openVolusionStorefrontCartSession({
      ...(cartUrl ? { cartUrl } : {}),
    });
    return res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open cart session";
    return res.status(500).json({ error: message });
  }
});

router.post("/cart-session/close", async (_req: Request, res: Response) => {
  try {
    await closeVolusionStorefrontCartSession();
    return res.json({ closed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to close cart session";
    return res.status(500).json({ error: message });
  }
});

router.post("/identify-user", async (req: Request, res: Response) => {
  try {
    const cartId =
      String((req.body as { cartId?: string } | undefined)?.cartId ?? "").trim() ||
      "07387C5E1E344F7DB151AE80E9894EE7";
    const result = await identifyVolusionUser(cartId);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to identify user";
    return res.status(500).json({ error: message });
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
  const rawItems = (Array.isArray(body.items) ? body.items : []) as QuoteItem[];
  const recalculated = recalcQuote(rawItems, {
    shippingTotal: Number(body.shippingTotal ?? 0),
    taxTotal: Number(body.taxTotal ?? 0),
  });

  const newQuote: Quote = {
    ...body,
    items: recalculated.items,
    subtotal: recalculated.subtotal,
    discountTotal: recalculated.discountTotal,
    shippingTotal: recalculated.shippingTotal,
    taxTotal: recalculated.taxTotal,
    grandTotal: recalculated.grandTotal,
  };

  quotes.unshift(newQuote);
  res.status(201).json(newQuote);
});

export default router;

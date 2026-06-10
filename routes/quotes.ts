import { Router, Request, Response } from "express";
import { Op, UniqueConstraintError } from "sequelize";
import { fetchCartProductsAsQuoteItems } from "../services/volusion";
import { identifyVolusionUser } from "../services/identifyUser";
import {
  clearVolusionStorefrontCart,
  closeVolusionStorefrontCartSession,
  openVolusionStorefrontCartSession,
  scrapeVolusionStorefrontCart,
} from "../services/scrapeStorefrontCart";
import { Quote, QuoteItem, sequelize } from "../lib/models";

const router = Router();
const toStringOrNull = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  return String(value);
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toDecimalStringOrNull = (value: unknown): string | null => {
  const num = toNumberOrNull(value);
  return num === null ? null : String(num);
};

const pickBodyValue = (body: Record<string, unknown>, snake: string, camel: string): unknown =>
  body[snake] !== undefined ? body[snake] : body[camel];
const uuidV4LikePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asObjectOrNull = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const mapQuoteItemInput = (item: unknown, quoteId: string) => {
  const entry = item as Record<string, unknown>;
  const rawOptions =
    entry.options_json !== undefined
      ? entry.options_json
      : entry.optionsJson !== undefined
        ? entry.optionsJson
        : null;
  const options = asObjectOrNull(rawOptions);
  const imageFromOptions = toStringOrNull(options?.image_url ?? options?.imageUrl ?? null);
  const imageFromItem = toStringOrNull(
    entry.image_url !== undefined ? entry.image_url : entry.imageUrl,
  );
  return {
    quoteId,
    productCode: toStringOrNull(
      entry.product_code !== undefined ? entry.product_code : entry.productCode,
    ),
    description: toStringOrNull(entry.description),
    optionalDescription: toStringOrNull(
      entry.optional_description !== undefined
        ? entry.optional_description
        : entry.optionalDescription,
    ),
    qty: toNumberOrNull(entry.qty),
    unitPrice: toDecimalStringOrNull(
      entry.unit_price !== undefined ? entry.unit_price : entry.unitPrice,
    ),
    amount: toDecimalStringOrNull(entry.amount),
    imageUrl: imageFromItem ?? imageFromOptions,
    optionsJson: options,
  };
};

const getQuotes = async (_req: Request, res: Response) => {
  try {
    const records = await Quote.findAll({
      include: [{ model: QuoteItem, as: "items" }],
      order: [["createdAt", "DESC"]],
    });
    return res.json({ data: records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch quotes";
    return res.status(500).json({ error: message });
  }
};

router.get("/", getQuotes);

router.get("/search", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      return res.json({ data: [] });
    }

    const records = await Quote.findAll({
      attributes: [
        "id",
        "quoteNumber",
        "quoteDate",
        "customerName",
        "company",
        "email",
        "total",
        "status",
      ],
      where: {
        [Op.or]: [
          { quoteNumber: { [Op.iLike]: `%${q}%` } },
          { customerName: { [Op.iLike]: `%${q}%` } },
          { company: { [Op.iLike]: `%${q}%` } },
          { email: { [Op.iLike]: `%${q}%` } },
        ],
      },
      order: [["createdAt", "DESC"]],
      limit: 15,
    });

    return res.json({ data: records });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to search quotes";
    return res.status(500).json({ error: message });
  }
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
    console.log("API RESPONSE scrape-cart shippingTotal:", payload.shippingTotal);
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

router.post("/clear-cart", async (req: Request, res: Response) => {
  try {
    const body = req.body as { cartUrl?: string } | undefined;
    const cartUrl = body?.cartUrl?.trim();
    const result = await clearVolusionStorefrontCart({
      ...(cartUrl ? { cartUrl } : {}),
    });
    const status = result.cartEmpty ? 200 : 502;
    return res.status(status).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear cart";
    return res.status(500).json({
      success: false,
      removedCount: 0,
      cartEmpty: false,
      method: "none",
      error: message,
    });
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

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const quoteId = String(req.params.id);
    if (!uuidV4LikePattern.test(quoteId)) {
      return res.status(400).json({ error: "Invalid quote id" });
    }
    const quote = await Quote.findByPk(quoteId, {
      include: [{ model: QuoteItem, as: "items" }],
    });
    if (!quote) {
      return res.status(404).json({ error: "Quote not found" });
    }
    return res.json(quote);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch quote";
    return res.status(500).json({ error: message });
  }
});

const createQuote = async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const body = req.body as Record<string, unknown>;
    const items = Array.isArray(body.items) ? body.items : [];
    console.log("POST /api/quotes payload:", body);

    const quote = await Quote.create(
      {
        quoteNumber: String(pickBodyValue(body, "quote_number", "quoteNumber") ?? ""),
        quoteDate: toStringOrNull(pickBodyValue(body, "quote_date", "quoteDate")),
        status: (toStringOrNull(body.status) ?? "draft"),
        version: Number(body.version ?? 1),
        customerName: toStringOrNull(pickBodyValue(body, "customer_name", "customerName")),
        company: toStringOrNull(body.company),
        email: toStringOrNull(body.email),
        phone: toStringOrNull(body.phone),
        address: toStringOrNull(body.address),
        notes: toStringOrNull(body.notes),
        subtotal: toDecimalStringOrNull(body.subtotal),
        shipping: toDecimalStringOrNull(body.shipping),
        shippingLabel: toStringOrNull(pickBodyValue(body, "shipping_label", "shippingLabel")),
        shippingState: toStringOrNull(pickBodyValue(body, "shipping_state", "shippingState")),
        shippingZip: toStringOrNull(pickBodyValue(body, "shipping_zip", "shippingZip")),
        taxRate: toDecimalStringOrNull(pickBodyValue(body, "tax_rate", "taxRate")),
        taxAmount: toDecimalStringOrNull(pickBodyValue(body, "tax_amount", "taxAmount")),
        taxLabel: toStringOrNull(pickBodyValue(body, "tax_label", "taxLabel")),
        taxDescription: toStringOrNull(pickBodyValue(body, "tax_description", "taxDescription")),
        total: toDecimalStringOrNull(body.total),
      },
      { transaction: tx },
    );

    if (items.length > 0) {
      await QuoteItem.bulkCreate(
        items.map((item) => mapQuoteItemInput(item, quote.id)),
        { transaction: tx },
      );
    }

    await tx.commit();
    const created = await Quote.findByPk(quote.id, {
      include: [{ model: QuoteItem, as: "items" }],
    });
    console.log("POST /api/quotes response:", created);
    return res.status(201).json(created);
  } catch (error) {
    await tx.rollback();
    console.error("POST /api/quotes failed:", error);
    if (error instanceof UniqueConstraintError) {
      return res.status(409).json({ error: "quote_number already exists" });
    }
    const message = error instanceof Error ? error.message : "Failed to create quote";
    return res.status(500).json({ error: message });
  }
};

router.post("/", createQuote);

router.put("/:id", async (req: Request, res: Response) => {
  const tx = await sequelize.transaction();
  try {
    const quoteId = String(req.params.id);
    if (!uuidV4LikePattern.test(quoteId)) {
      await tx.rollback();
      return res.status(400).json({ error: "Invalid quote id" });
    }
    const quote = await Quote.findByPk(quoteId, { transaction: tx });
    if (!quote) {
      await tx.rollback();
      return res.status(404).json({ error: "Quote not found" });
    }

    const body = req.body as Record<string, unknown>;
    const incomingQuoteNumberRaw = pickBodyValue(body, "quote_number", "quoteNumber");
    const incomingQuoteNumber =
      incomingQuoteNumberRaw === undefined ? undefined : String(incomingQuoteNumberRaw).trim();
    if (incomingQuoteNumber !== undefined) {
      const duplicate = await Quote.findOne({
        where: {
          quoteNumber: incomingQuoteNumber,
          id: { [Op.ne]: quote.id },
        },
        transaction: tx,
      });
      if (duplicate) {
        await tx.rollback();
        return res.status(409).json({ error: "quote_number already exists" });
      }
    }
    const updates: Record<string, unknown> = {};

    if (incomingQuoteNumber !== undefined) updates.quoteNumber = incomingQuoteNumber;
    if (pickBodyValue(body, "quote_date", "quoteDate") !== undefined) {
      updates.quoteDate = toStringOrNull(pickBodyValue(body, "quote_date", "quoteDate"));
    }
    if (body.status !== undefined) updates.status = String(body.status);
    if (body.version !== undefined) updates.version = Number(body.version);
    if (pickBodyValue(body, "customer_name", "customerName") !== undefined) {
      updates.customerName = toStringOrNull(pickBodyValue(body, "customer_name", "customerName"));
    }
    if (body.company !== undefined) updates.company = (body.company as string | null) ?? null;
    if (body.email !== undefined) updates.email = (body.email as string | null) ?? null;
    if (body.phone !== undefined) updates.phone = (body.phone as string | null) ?? null;
    if (body.address !== undefined) updates.address = (body.address as string | null) ?? null;
    if (body.notes !== undefined) updates.notes = (body.notes as string | null) ?? null;
    if (body.subtotal !== undefined) updates.subtotal = toDecimalStringOrNull(body.subtotal);
    if (body.shipping !== undefined) updates.shipping = toDecimalStringOrNull(body.shipping);
    if (pickBodyValue(body, "shipping_label", "shippingLabel") !== undefined) {
      updates.shippingLabel = toStringOrNull(pickBodyValue(body, "shipping_label", "shippingLabel"));
    }
    if (pickBodyValue(body, "shipping_state", "shippingState") !== undefined) {
      updates.shippingState = toStringOrNull(pickBodyValue(body, "shipping_state", "shippingState"));
    }
    if (pickBodyValue(body, "shipping_zip", "shippingZip") !== undefined) {
      updates.shippingZip = toStringOrNull(pickBodyValue(body, "shipping_zip", "shippingZip"));
    }
    if (pickBodyValue(body, "tax_rate", "taxRate") !== undefined) {
      updates.taxRate = toDecimalStringOrNull(pickBodyValue(body, "tax_rate", "taxRate"));
    }
    if (pickBodyValue(body, "tax_amount", "taxAmount") !== undefined) {
      updates.taxAmount = toDecimalStringOrNull(pickBodyValue(body, "tax_amount", "taxAmount"));
    }
    if (pickBodyValue(body, "tax_label", "taxLabel") !== undefined) {
      updates.taxLabel = toStringOrNull(pickBodyValue(body, "tax_label", "taxLabel"));
    }
    if (pickBodyValue(body, "tax_description", "taxDescription") !== undefined) {
      updates.taxDescription = toStringOrNull(pickBodyValue(body, "tax_description", "taxDescription"));
    }
    if (body.total !== undefined) updates.total = body.total != null ? String(body.total) : null;

    await quote.update(updates, { transaction: tx });

    if (Array.isArray(body.items)) {
      await QuoteItem.destroy({ where: { quoteId: quote.id }, transaction: tx });
      if (body.items.length > 0) {
        await QuoteItem.bulkCreate(
          body.items.map((item) => mapQuoteItemInput(item, quote.id)),
          { transaction: tx },
        );
      }
    }

    await tx.commit();
    const updated = await Quote.findByPk(quote.id, {
      include: [{ model: QuoteItem, as: "items" }],
    });
    return res.json(updated);
  } catch (error) {
    await tx.rollback();
    if (error instanceof UniqueConstraintError) {
      return res.status(409).json({ error: "quote_number already exists" });
    }
    const message = error instanceof Error ? error.message : "Failed to update quote";
    return res.status(500).json({ error: message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const quoteId = String(req.params.id);
    const deleted = await Quote.destroy({ where: { id: quoteId } });
    if (!deleted) {
      return res.status(404).json({ error: "Quote not found" });
    }
    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete quote";
    return res.status(500).json({ error: message });
  }
});

export default router;

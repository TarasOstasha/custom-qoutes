"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sequelize_1 = require("sequelize");
const volusion_1 = require("../services/volusion");
const identifyUser_1 = require("../services/identifyUser");
const scrapeStorefrontCart_1 = require("../services/scrapeStorefrontCart");
const models_1 = require("../lib/models");
const router = (0, express_1.Router)();
const toStringOrNull = (value) => {
    if (value === undefined || value === null)
        return null;
    return String(value);
};
const toNumberOrNull = (value) => {
    if (value === undefined || value === null || value === "")
        return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};
const toDecimalStringOrNull = (value) => {
    const num = toNumberOrNull(value);
    return num === null ? null : String(num);
};
const pickBodyValue = (body, snake, camel) => body[snake] !== undefined ? body[snake] : body[camel];
const uuidV4LikePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const getQuotes = async (_req, res) => {
    try {
        const records = await models_1.Quote.findAll({
            include: [{ model: models_1.QuoteItem, as: "items" }],
            order: [["createdAt", "DESC"]],
        });
        return res.json({ data: records });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch quotes";
        return res.status(500).json({ error: message });
    }
};
router.get("/", getQuotes);
router.get("/search", async (req, res) => {
    try {
        const q = String(req.query.q ?? "").trim();
        if (!q) {
            return res.json({ data: [] });
        }
        const records = await models_1.Quote.findAll({
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
                [sequelize_1.Op.or]: [
                    { quoteNumber: { [sequelize_1.Op.iLike]: `%${q}%` } },
                    { customerName: { [sequelize_1.Op.iLike]: `%${q}%` } },
                    { company: { [sequelize_1.Op.iLike]: `%${q}%` } },
                    { email: { [sequelize_1.Op.iLike]: `%${q}%` } },
                ],
            },
            order: [["createdAt", "DESC"]],
            limit: 15,
        });
        return res.json({ data: records });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to search quotes";
        return res.status(500).json({ error: message });
    }
});
// products
router.get("/products", async (req, res) => {
    try {
        const rawCodes = String(req.query.codes ?? "");
        const codes = rawCodes
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        if (!codes.length) {
            return res.json({ items: [] });
        }
        console.log(codes, 'rawCodes');
        const popupItems = codes.map((productCode) => ({ productCode, qty: 1 }));
        const items = await (0, volusion_1.fetchCartProductsAsQuoteItems)(popupItems);
        console.log(items, 'items');
        return res.json({ items });
    }
    catch (error) {
        return res.status(500).json({ error: "Failed to load products" });
    }
});
router.get("/cart-products", async (req, res) => {
    try {
        const rawCodes = String(req.query.codes ?? "");
        const codes = rawCodes
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        if (!codes.length) {
            return res.json({ items: [] });
        }
        console.log(codes, 'rawCodes');
        const cartItems = codes.map((productCode) => ({ productCode, qty: 1 }));
        const items = await (0, volusion_1.fetchCartProductsAsQuoteItems)(cartItems);
        console.log(items, 'items');
        return res.json({ items });
    }
    catch (error) {
        return res.status(500).json({ error: "Failed to load cart products" });
    }
});
router.get("/image-proxy", async (req, res) => {
    try {
        const raw = String(req.query.url ?? "").trim();
        if (!raw)
            return res.status(400).json({ error: "Missing url" });
        let target;
        try {
            target = new URL(raw);
        }
        catch {
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
    }
    catch {
        return res.status(500).json({ error: "Image proxy failed" });
    }
});
router.post("/scrape-cart", async (req, res) => {
    try {
        const body = req.body;
        const cartUrl = body?.cartUrl?.trim();
        const payload = await (0, scrapeStorefrontCart_1.scrapeVolusionStorefrontCart)({
            ...(cartUrl ? { cartUrl } : {}),
        });
        return res.json(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to scrape cart";
        return res.status(500).json({ error: message });
    }
});
router.post("/cart-session/open", async (req, res) => {
    try {
        const body = req.body;
        const cartUrl = body?.cartUrl?.trim();
        const data = await (0, scrapeStorefrontCart_1.openVolusionStorefrontCartSession)({
            ...(cartUrl ? { cartUrl } : {}),
        });
        return res.json(data);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open cart session";
        return res.status(500).json({ error: message });
    }
});
router.post("/cart-session/close", async (_req, res) => {
    try {
        await (0, scrapeStorefrontCart_1.closeVolusionStorefrontCartSession)();
        return res.json({ closed: true });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to close cart session";
        return res.status(500).json({ error: message });
    }
});
router.post("/identify-user", async (req, res) => {
    try {
        const cartId = String(req.body?.cartId ?? "").trim() ||
            "07387C5E1E344F7DB151AE80E9894EE7";
        const result = await (0, identifyUser_1.identifyVolusionUser)(cartId);
        return res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to identify user";
        return res.status(500).json({ error: message });
    }
});
router.get("/:id", async (req, res) => {
    try {
        const quoteId = String(req.params.id);
        if (!uuidV4LikePattern.test(quoteId)) {
            return res.status(400).json({ error: "Invalid quote id" });
        }
        const quote = await models_1.Quote.findByPk(quoteId, {
            include: [{ model: models_1.QuoteItem, as: "items" }],
        });
        if (!quote) {
            return res.status(404).json({ error: "Quote not found" });
        }
        return res.json(quote);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch quote";
        return res.status(500).json({ error: message });
    }
});
const createQuote = async (req, res) => {
    const tx = await models_1.sequelize.transaction();
    try {
        const body = req.body;
        const items = Array.isArray(body.items) ? body.items : [];
        console.log("POST /api/quotes payload:", body);
        const quote = await models_1.Quote.create({
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
            taxRate: toDecimalStringOrNull(pickBodyValue(body, "tax_rate", "taxRate")),
            taxAmount: toDecimalStringOrNull(pickBodyValue(body, "tax_amount", "taxAmount")),
            total: toDecimalStringOrNull(body.total),
        }, { transaction: tx });
        if (items.length > 0) {
            await models_1.QuoteItem.bulkCreate(items.map((item) => {
                const entry = item;
                return {
                    quoteId: quote.id,
                    productCode: toStringOrNull(entry.product_code !== undefined ? entry.product_code : entry.productCode),
                    description: toStringOrNull(entry.description),
                    optionalDescription: toStringOrNull(entry.optional_description !== undefined
                        ? entry.optional_description
                        : entry.optionalDescription),
                    qty: toNumberOrNull(entry.qty),
                    unitPrice: toDecimalStringOrNull(entry.unit_price !== undefined ? entry.unit_price : entry.unitPrice),
                    amount: toDecimalStringOrNull(entry.amount),
                    imageUrl: toStringOrNull(entry.image_url !== undefined ? entry.image_url : entry.imageUrl),
                    optionsJson: (entry.options_json !== undefined
                        ? entry.options_json
                        : entry.optionsJson),
                };
            }), { transaction: tx });
        }
        await tx.commit();
        const created = await models_1.Quote.findByPk(quote.id, {
            include: [{ model: models_1.QuoteItem, as: "items" }],
        });
        console.log("POST /api/quotes response:", created);
        return res.status(201).json(created);
    }
    catch (error) {
        await tx.rollback();
        console.error("POST /api/quotes failed:", error);
        const message = error instanceof Error ? error.message : "Failed to create quote";
        return res.status(500).json({ error: message });
    }
};
router.post("/", createQuote);
router.put("/:id", async (req, res) => {
    const tx = await models_1.sequelize.transaction();
    try {
        const quoteId = String(req.params.id);
        const quote = await models_1.Quote.findByPk(quoteId, { transaction: tx });
        if (!quote) {
            await tx.rollback();
            return res.status(404).json({ error: "Quote not found" });
        }
        const body = req.body;
        const updates = {};
        if (body.quoteNumber !== undefined)
            updates.quoteNumber = String(body.quoteNumber);
        if (body.quoteDate !== undefined)
            updates.quoteDate = body.quoteDate ?? null;
        if (body.status !== undefined)
            updates.status = String(body.status);
        if (body.version !== undefined)
            updates.version = Number(body.version);
        if (body.customerName !== undefined)
            updates.customerName = body.customerName ?? null;
        if (body.company !== undefined)
            updates.company = body.company ?? null;
        if (body.email !== undefined)
            updates.email = body.email ?? null;
        if (body.phone !== undefined)
            updates.phone = body.phone ?? null;
        if (body.address !== undefined)
            updates.address = body.address ?? null;
        if (body.notes !== undefined)
            updates.notes = body.notes ?? null;
        if (body.subtotal !== undefined)
            updates.subtotal = body.subtotal != null ? String(body.subtotal) : null;
        if (body.shipping !== undefined)
            updates.shipping = body.shipping != null ? String(body.shipping) : null;
        if (body.taxRate !== undefined)
            updates.taxRate = body.taxRate != null ? String(body.taxRate) : null;
        if (body.taxAmount !== undefined)
            updates.taxAmount = body.taxAmount != null ? String(body.taxAmount) : null;
        if (body.total !== undefined)
            updates.total = body.total != null ? String(body.total) : null;
        await quote.update(updates, { transaction: tx });
        if (Array.isArray(body.items)) {
            await models_1.QuoteItem.destroy({ where: { quoteId: quote.id }, transaction: tx });
            if (body.items.length > 0) {
                await models_1.QuoteItem.bulkCreate(body.items.map((item) => {
                    const entry = item;
                    return {
                        quoteId: quote.id,
                        productCode: entry.productCode ?? null,
                        description: entry.description ?? null,
                        optionalDescription: entry.optionalDescription ?? null,
                        qty: entry.qty != null ? Number(entry.qty) : null,
                        unitPrice: entry.unitPrice != null ? String(entry.unitPrice) : null,
                        amount: entry.amount != null ? String(entry.amount) : null,
                        optionsJson: entry.optionsJson ?? null,
                    };
                }), { transaction: tx });
            }
        }
        await tx.commit();
        const updated = await models_1.Quote.findByPk(quote.id, {
            include: [{ model: models_1.QuoteItem, as: "items" }],
        });
        return res.json(updated);
    }
    catch (error) {
        await tx.rollback();
        const message = error instanceof Error ? error.message : "Failed to update quote";
        return res.status(500).json({ error: message });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const quoteId = String(req.params.id);
        const deleted = await models_1.Quote.destroy({ where: { id: quoteId } });
        if (!deleted) {
            return res.status(404).json({ error: "Quote not found" });
        }
        return res.status(204).send();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete quote";
        return res.status(500).json({ error: message });
    }
});
exports.default = router;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const recalcQuote_1 = require("../lib/recalcQuote");
const quotes_1 = require("../mock/quotes");
const volusion_1 = require("../services/volusion");
const identifyUser_1 = require("../services/identifyUser");
const scrapeStorefrontCart_1 = require("../services/scrapeStorefrontCart");
const router = (0, express_1.Router)();
router.get("/", (_req, res) => {
    res.json({ data: quotes_1.quotes });
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
router.get("/:id", (req, res) => {
    console.log(req.query.codes, 'body');
    const quote = quotes_1.quotes.find((q) => q.id === req.params.id);
    console.log(quote, 'quote');
    if (!quote)
        return res.status(404).json({ error: "Quote not found" });
    res.json(quote);
});
router.post("/", (req, res) => {
    const body = req.body;
    const rawItems = (Array.isArray(body.items) ? body.items : []);
    const recalculated = (0, recalcQuote_1.recalcQuote)(rawItems, {
        shippingTotal: Number(body.shippingTotal ?? 0),
        taxTotal: Number(body.taxTotal ?? 0),
    });
    const newQuote = {
        ...body,
        items: recalculated.items,
        subtotal: recalculated.subtotal,
        discountTotal: recalculated.discountTotal,
        shippingTotal: recalculated.shippingTotal,
        taxTotal: recalculated.taxTotal,
        grandTotal: recalculated.grandTotal,
    };
    quotes_1.quotes.unshift(newQuote);
    res.status(201).json(newQuote);
});
exports.default = router;

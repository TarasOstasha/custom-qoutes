"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const quotes_1 = require("../mock/quotes");
const volusion_1 = require("../services/volusion");
const identifyUser_1 = require("../services/identifyUser");
const scrapeStorefrontCart_1 = require("../services/scrapeStorefrontCart");
const router = (0, express_1.Router)();
function round2(n) {
    return Math.round(n * 100) / 100;
}
function calcLine(item) {
    const lineSubtotal = round2(item.qty * item.unitPrice);
    let lineDiscountTotal = 0;
    if (item.discountType === "amount") {
        lineDiscountTotal = round2(item.discountValue);
    }
    else if (item.discountType === "percent") {
        lineDiscountTotal = round2((lineSubtotal * item.discountValue) / 100);
    }
    lineDiscountTotal = Math.min(lineDiscountTotal, lineSubtotal);
    const lineTotal = round2(lineSubtotal - lineDiscountTotal);
    return { lineSubtotal, lineDiscountTotal, lineTotal };
}
function calcQuoteTotals(items) {
    const nonShippingItems = items.filter((i) => i.name !== "Shipping");
    const shippingItems = items.filter((i) => i.name === "Shipping");
    const subtotal = round2(nonShippingItems.reduce((sum, i) => sum + i.lineSubtotal, 0));
    const discountTotal = round2(nonShippingItems.reduce((sum, i) => sum + i.lineDiscountTotal, 0));
    const shippingTotal = round2(shippingItems.reduce((sum, i) => sum + i.lineTotal, 0));
    const taxTotal = 0;
    const grandTotal = round2(subtotal - discountTotal + shippingTotal + taxTotal);
    return { subtotal, discountTotal, shippingTotal, taxTotal, grandTotal };
}
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
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems.map((item) => {
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
    const newQuote = {
        ...body,
        items,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        shippingTotal: totals.shippingTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
    };
    quotes_1.quotes.unshift(newQuote);
    res.status(201).json(newQuote);
});
exports.default = router;

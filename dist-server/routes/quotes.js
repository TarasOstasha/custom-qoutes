"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sequelize_1 = require("sequelize");
const volusion_1 = require("../services/volusion");
const identifyUser_1 = require("../services/identifyUser");
const scrapeStorefrontCart_1 = require("../services/scrapeStorefrontCart");
const models_1 = require("../lib/models");
const quoteNumberValidation_1 = require("../lib/quoteNumberValidation");
const officePersistence_1 = require("../lib/officePersistence");
const router = (0, express_1.Router)();
const offlineListResponse = () => ({ data: [], offline: true });
const offlineSaveResponse = () => ({
    persisted: false,
    offline: true,
    message: officePersistence_1.OFFLINE_PERSISTENCE_MESSAGE,
});
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
const asObjectOrNull = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
};
const mapQuoteItemInput = (item, quoteId) => {
    const entry = item;
    const rawOptions = entry.options_json !== undefined
        ? entry.options_json
        : entry.optionsJson !== undefined
            ? entry.optionsJson
            : null;
    const options = asObjectOrNull(rawOptions);
    const imageFromOptions = toStringOrNull(options?.image_url ?? options?.imageUrl ?? null);
    const imageFromItem = toStringOrNull(entry.image_url !== undefined ? entry.image_url : entry.imageUrl);
    return {
        quoteId,
        productCode: toStringOrNull(entry.product_code !== undefined ? entry.product_code : entry.productCode),
        description: toStringOrNull(entry.description),
        optionalDescription: toStringOrNull(entry.optional_description !== undefined
            ? entry.optional_description
            : entry.optionalDescription),
        qty: toNumberOrNull(entry.qty),
        unitPrice: toDecimalStringOrNull(entry.unit_price !== undefined ? entry.unit_price : entry.unitPrice),
        amount: toDecimalStringOrNull(entry.amount),
        imageUrl: imageFromItem ?? imageFromOptions,
        optionsJson: options,
    };
};
const getQuotes = async (_req, res) => {
    try {
        if (!(await (0, officePersistence_1.isOfficePersistenceAvailable)())) {
            return res.json(offlineListResponse());
        }
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
        if (!(await (0, officePersistence_1.isOfficePersistenceAvailable)())) {
            return res.json(offlineListResponse());
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
        console.log("API RESPONSE scrape-cart shippingTotal:", payload.shippingTotal);
        console.log("API RESPONSE scrape-cart selectedShippingValue:", payload.selectedShippingValue ?? null);
        console.log("API RESPONSE scrape-cart shippingOptions:", payload.shippingOptions?.length ?? 0);
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
router.post("/clear-cart", async (req, res) => {
    try {
        const body = req.body;
        const cartUrl = body?.cartUrl?.trim();
        const result = await (0, scrapeStorefrontCart_1.clearVolusionStorefrontCart)({
            ...(cartUrl ? { cartUrl } : {}),
        });
        const status = result.cartEmpty ? 200 : 502;
        return res.status(status).json(result);
    }
    catch (error) {
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
        if (!(await (0, officePersistence_1.isOfficePersistenceAvailable)())) {
            return res.status(503).json({
                error: "Database is unavailable — saved quotes cannot be loaded.",
                offline: true,
            });
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
    if (!(await (0, officePersistence_1.isOfficePersistenceAvailable)())) {
        return res.status(200).json(offlineSaveResponse());
    }
    const tx = await (0, models_1.getActiveSequelize)().transaction();
    try {
        const body = req.body;
        const items = Array.isArray(body.items) ? body.items : [];
        const quoteNumber = String(pickBodyValue(body, "quote_number", "quoteNumber") ?? "").trim();
        console.log("[POST /api/quotes] insert request:", {
            quoteNumber,
            itemCount: items.length,
        });
        if (!quoteNumber) {
            await tx.rollback();
            return res.status(400).json({ error: "quote_number is required" });
        }
        const duplicate = await (0, quoteNumberValidation_1.findQuoteByNumber)(quoteNumber, { transaction: tx });
        if (duplicate) {
            await tx.rollback();
            console.log("[POST /api/quotes] duplicate quote number rejected:", quoteNumber);
            return res.status(409).json({ error: (0, quoteNumberValidation_1.duplicateQuoteNumberError)(quoteNumber) });
        }
        const quote = await models_1.Quote.create({
            quoteNumber,
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
            shippingMethod: toStringOrNull(pickBodyValue(body, "shipping_method", "shippingMethod")),
            shippingOptionsJson: pickBodyValue(body, "shipping_options_json", "shippingOptionsJson") ?? null,
            shippingState: toStringOrNull(pickBodyValue(body, "shipping_state", "shippingState")),
            shippingZip: toStringOrNull(pickBodyValue(body, "shipping_zip", "shippingZip")),
            taxRate: toDecimalStringOrNull(pickBodyValue(body, "tax_rate", "taxRate")),
            taxAmount: toDecimalStringOrNull(pickBodyValue(body, "tax_amount", "taxAmount")),
            taxLabel: toStringOrNull(pickBodyValue(body, "tax_label", "taxLabel")),
            taxDescription: toStringOrNull(pickBodyValue(body, "tax_description", "taxDescription")),
            total: toDecimalStringOrNull(body.total),
        }, { transaction: tx });
        if (items.length > 0) {
            await models_1.QuoteItem.bulkCreate(items.map((item) => mapQuoteItemInput(item, quote.id)), { transaction: tx });
        }
        await tx.commit();
        const created = await models_1.Quote.findByPk(quote.id, {
            include: [{ model: models_1.QuoteItem, as: "items" }],
        });
        console.log("[POST /api/quotes] created:", {
            id: created?.id,
            quoteNumber: created?.quoteNumber,
        });
        return res.status(201).json(created);
    }
    catch (error) {
        await tx.rollback();
        console.error("[POST /api/quotes] failed:", error);
        if (error instanceof sequelize_1.UniqueConstraintError) {
            const body = req.body;
            const quoteNumber = String(pickBodyValue(body, "quote_number", "quoteNumber") ?? "").trim();
            return res.status(409).json({
                error: quoteNumber
                    ? (0, quoteNumberValidation_1.duplicateQuoteNumberError)(quoteNumber)
                    : "quote_number already exists",
            });
        }
        const message = error instanceof Error ? error.message : "Failed to create quote";
        return res.status(500).json({ error: message });
    }
};
router.post("/", createQuote);
router.put("/:id", async (req, res) => {
    if (!(await (0, officePersistence_1.isOfficePersistenceAvailable)())) {
        return res.status(200).json(offlineSaveResponse());
    }
    const tx = await (0, models_1.getActiveSequelize)().transaction();
    try {
        const quoteId = String(req.params.id);
        if (!uuidV4LikePattern.test(quoteId)) {
            await tx.rollback();
            return res.status(400).json({ error: "Invalid quote id" });
        }
        const quote = await models_1.Quote.findByPk(quoteId, { transaction: tx });
        if (!quote) {
            await tx.rollback();
            return res.status(404).json({ error: "Quote not found" });
        }
        const body = req.body;
        const incomingQuoteNumberRaw = pickBodyValue(body, "quote_number", "quoteNumber");
        const incomingQuoteNumber = incomingQuoteNumberRaw === undefined ? undefined : String(incomingQuoteNumberRaw).trim();
        console.log("[PUT /api/quotes/:id] update request:", {
            quoteId,
            incomingQuoteNumber,
        });
        if (incomingQuoteNumber !== undefined) {
            const duplicate = await (0, quoteNumberValidation_1.findQuoteByNumber)(incomingQuoteNumber, {
                excludeQuoteId: quote.id,
                transaction: tx,
            });
            if (duplicate) {
                await tx.rollback();
                console.log("[PUT /api/quotes/:id] duplicate quote number rejected:", incomingQuoteNumber);
                return res.status(409).json({ error: (0, quoteNumberValidation_1.duplicateQuoteNumberError)(incomingQuoteNumber) });
            }
        }
        const updates = {};
        if (incomingQuoteNumber !== undefined)
            updates.quoteNumber = incomingQuoteNumber;
        if (pickBodyValue(body, "quote_date", "quoteDate") !== undefined) {
            updates.quoteDate = toStringOrNull(pickBodyValue(body, "quote_date", "quoteDate"));
        }
        if (body.status !== undefined)
            updates.status = String(body.status);
        if (body.version !== undefined)
            updates.version = Number(body.version);
        if (pickBodyValue(body, "customer_name", "customerName") !== undefined) {
            updates.customerName = toStringOrNull(pickBodyValue(body, "customer_name", "customerName"));
        }
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
            updates.subtotal = toDecimalStringOrNull(body.subtotal);
        if (body.shipping !== undefined)
            updates.shipping = toDecimalStringOrNull(body.shipping);
        if (pickBodyValue(body, "shipping_label", "shippingLabel") !== undefined) {
            updates.shippingLabel = toStringOrNull(pickBodyValue(body, "shipping_label", "shippingLabel"));
        }
        if (pickBodyValue(body, "shipping_method", "shippingMethod") !== undefined) {
            updates.shippingMethod = toStringOrNull(pickBodyValue(body, "shipping_method", "shippingMethod"));
        }
        if (pickBodyValue(body, "shipping_options_json", "shippingOptionsJson") !== undefined) {
            updates.shippingOptionsJson =
                pickBodyValue(body, "shipping_options_json", "shippingOptionsJson") ?? null;
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
        if (body.total !== undefined)
            updates.total = body.total != null ? String(body.total) : null;
        await quote.update(updates, { transaction: tx });
        if (Array.isArray(body.items)) {
            await models_1.QuoteItem.destroy({ where: { quoteId: quote.id }, transaction: tx });
            if (body.items.length > 0) {
                await models_1.QuoteItem.bulkCreate(body.items.map((item) => mapQuoteItemInput(item, quote.id)), { transaction: tx });
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
        if (error instanceof sequelize_1.UniqueConstraintError) {
            const body = req.body;
            const quoteNumber = String(pickBodyValue(body, "quote_number", "quoteNumber") ?? "").trim();
            return res.status(409).json({
                error: quoteNumber
                    ? (0, quoteNumberValidation_1.duplicateQuoteNumberError)(quoteNumber)
                    : "quote_number already exists",
            });
        }
        const message = error instanceof Error ? error.message : "Failed to update quote";
        return res.status(500).json({ error: message });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        if (!(await (0, officePersistence_1.isOfficePersistenceAvailable)())) {
            return res.status(503).json({
                error: "Database is unavailable — quotes cannot be deleted.",
                offline: true,
            });
        }
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

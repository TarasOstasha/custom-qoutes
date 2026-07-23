"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isImportableVolusionCartRow = isImportableVolusionCartRow;
exports.buildStableCartLineId = buildStableCartLineId;
exports.resolveCartLineId = resolveCartLineId;
exports.findCartRowForQuoteItem = findCartRowForQuoteItem;
exports.collectOptionsForCartLine = collectOptionsForCartLine;
exports.mapCartRowsToQuoteItems = mapCartRowsToQuoteItems;
exports.removeQuoteLineById = removeQuoteLineById;
exports.updateQuoteLineQty = updateQuoteLineQty;
exports.serializeQuoteItemsForDb = serializeQuoteItemsForDb;
exports.deserializeQuoteItemFromDb = deserializeQuoteItemFromDb;
const recalcQuote_1 = require("./recalcQuote");
/** Volusion cart lines must have a positive EACH/TOTAL price; option sub-rows repeat the SKU at $0. */
function isImportableVolusionCartRow(params) {
    return params.unitPrice > 0 || params.lineTotal > 0;
}
/** Fallback when Volusion does not expose a cart row id in the DOM. */
function buildStableCartLineId(row, rowIndex) {
    const productCode = (row.productCode ?? "").trim().toLowerCase() || "item";
    const unitCents = Math.round((row.unitPrice ?? 0) * 100);
    const totalCents = Math.round((row.lineTotal ?? 0) * 100);
    const optionsKey = (row.options ?? [])
        .map((option) => option.trim().toLowerCase())
        .filter(Boolean)
        .join("|")
        .slice(0, 120)
        .replace(/\W+/g, "_") || "noopts";
    return `import_${productCode}_r${rowIndex}_p${unitCents}_t${totalCents}_${optionsKey}`;
}
function resolveCartLineId(row, rowIndex) {
    const fromRow = (row.cartLineId ?? "").trim();
    if (fromRow)
        return fromRow;
    return buildStableCartLineId(row, rowIndex);
}
function findCartRowForQuoteItem(item, cartItems) {
    const importLineId = (item.importLineId ?? "").trim();
    if (importLineId) {
        const byStoredId = cartItems.find((row) => (row.cartLineId ?? "").trim() === importLineId);
        if (byStoredId)
            return byStoredId;
        const byResolved = cartItems.find((row, index) => resolveCartLineId(row, index) === importLineId);
        if (byResolved)
            return byResolved;
    }
    const sku = (item.sku ?? item.sourceProductId ?? "").trim().toLowerCase();
    const unitPrice = Number(item.unitPrice);
    if (sku && Number.isFinite(unitPrice) && unitPrice > 0) {
        return cartItems.find((row) => (row.productCode ?? "").trim().toLowerCase() === sku &&
            Math.abs((row.unitPrice ?? 0) - unitPrice) < 0.01);
    }
    return undefined;
}
function collectOptionsForCartLine(item, cartItems) {
    const cartRow = findCartRowForQuoteItem(item, cartItems);
    if (cartRow?.options?.length) {
        return cartRow.options.map((option) => option.trim()).filter(Boolean);
    }
    if (item.chosenOptions?.length) {
        return item.chosenOptions.map((option) => option.trim()).filter(Boolean);
    }
    return [];
}
function mapCartRowsToQuoteItems(params) {
    const { cartItems, quoteId, startSortOrder } = params;
    const now = params.now ?? new Date().toISOString();
    const idPrefix = params.idPrefix ?? "qi_scrape";
    const importBatch = Date.now();
    const rows = cartItems.filter((row) => {
        const productCode = (row.productCode ?? "").trim();
        const name = (row.name ?? "").trim();
        if (!productCode && !name)
            return false;
        if (/^empty my entire cart$/i.test(name))
            return false;
        if (!isImportableVolusionCartRow({ unitPrice: row.unitPrice, lineTotal: row.lineTotal }))
            return false;
        return true;
    });
    return rows.map((row, index) => {
        const importLineId = resolveCartLineId(row, index);
        const qty = Number.isFinite(row.qty) && row.qty > 0 ? row.qty : 1;
        const unitPrice = Number.isFinite(row.unitPrice) && row.unitPrice > 0
            ? row.unitPrice
            : qty > 0 && Number.isFinite(row.lineTotal)
                ? (0, recalcQuote_1.round2)(row.lineTotal / qty)
                : 0;
        const lineSubtotal = (0, recalcQuote_1.round2)(unitPrice * qty);
        return {
            id: `${idPrefix}_${importBatch}_${index}`,
            quoteId,
            lineType: "product",
            sourceProductId: row.productCode || null,
            sku: row.productCode || null,
            importLineId,
            imageUrl: row.imageUrl ?? null,
            name: row.name || row.productCode || "Cart Item",
            description: null,
            chosenOptions: null,
            qty,
            unitPrice,
            discountType: "none",
            discountValue: 0,
            sortOrder: startSortOrder + index + 1,
            lineSubtotal,
            lineDiscountTotal: 0,
            lineTotal: lineSubtotal,
            createdAt: now,
            updatedAt: now,
        };
    });
}
/** Quote line helpers used in tests to simulate builder edits without React. */
function removeQuoteLineById(items, itemId) {
    return items.filter((item) => item.id !== itemId);
}
function updateQuoteLineQty(items, itemId, qty) {
    return items.map((item) => (item.id === itemId ? { ...item, qty, updatedAt: new Date().toISOString() } : item));
}
function serializeQuoteItemsForDb(items) {
    return items.map((item) => ({
        product_code: item.sku ?? item.sourceProductId ?? null,
        description: item.name ?? null,
        optional_description: item.description ?? null,
        image_url: item.imageUrl || null,
        qty: Number(item.qty),
        unit_price: Number(item.unitPrice),
        amount: Number(item.lineTotal),
        options_json: item.chosenOptions?.length || item.imageUrl || item.importLineId
            ? {
                ...(item.chosenOptions?.length ? { chosen_options: item.chosenOptions } : {}),
                ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
                ...(item.importLineId ? { import_line_id: item.importLineId } : {}),
            }
            : null,
    }));
}
function deserializeQuoteItemFromDb(item, index, quoteId, now) {
    const qty = Number(item.qty) || 1;
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0) || 0;
    const amount = Number(item.amount) || (0, recalcQuote_1.round2)(qty * unitPrice);
    const productCode = item.productCode ?? item.product_code ?? null;
    const options = item.optionsJson ?? item.options_json ?? null;
    const imageFromDb = (item.imageUrl ?? item.image_url ?? "").trim() || null;
    const imageFromOptions = options?.image_url?.trim() || null;
    return {
        id: item.id ?? `qi_loaded_${Date.now()}_${index}`,
        quoteId,
        lineType: productCode ? "product" : "custom",
        sourceProductId: productCode,
        sku: productCode,
        importLineId: options?.import_line_id ?? null,
        imageUrl: imageFromDb ?? imageFromOptions,
        name: item.description ?? productCode ?? "Line Item",
        description: item.optionalDescription ?? item.optional_description ?? null,
        chosenOptions: options?.chosen_options ?? null,
        qty,
        unitPrice,
        discountType: "none",
        discountValue: 0,
        discountScope: null,
        sortOrder: index + 1,
        lineSubtotal: amount,
        lineDiscountTotal: 0,
        lineTotal: amount,
        createdAt: now,
        updatedAt: now,
    };
}

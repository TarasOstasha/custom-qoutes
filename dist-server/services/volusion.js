"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCartProductsAsQuoteItems = fetchCartProductsAsQuoteItems;
function tagValue(block, tag) {
    const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
    return match?.[1]?.trim();
}
function parseVolusionResponse(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    try {
        const parsed = JSON.parse(trimmed);
        const row = Array.isArray(parsed) ? parsed[0] : parsed;
        if (row && typeof row === "object")
            return row;
    }
    catch {
        // Non-JSON response; fall through to XML parser.
    }
    const tableBlockMatch = trimmed.match(/<Table[\s\S]*?<\/Table>/i);
    const block = tableBlockMatch?.[0] ?? trimmed;
    const product = {
        ProductCode: tagValue(block, "ProductCode"),
        ProductID: tagValue(block, "ProductID"),
        ProductName: tagValue(block, "ProductName"),
        Vendor_PartNo: tagValue(block, "Vendor_PartNo"),
        ProductPrice: tagValue(block, "ProductPrice"),
        Vendor_Price: tagValue(block, "Vendor_Price"),
    };
    if (!product.ProductCode && !product.ProductName)
        return null;
    return product;
}
function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function toQuoteItem(product, qty, index) {
    const now = new Date().toISOString();
    const unitPrice = toNumber(product.ProductPrice ?? product.Vendor_Price, 0);
    const safeQty = toNumber(qty, 0);
    const lineSubtotal = Number((safeQty * unitPrice).toFixed(2));
    return {
        id: `qi_cart_${Date.now()}_${index}`,
        quoteId: "",
        lineType: "product",
        sourceProductId: product.ProductID ?? null,
        sku: product.ProductCode ?? product.Vendor_PartNo ?? null,
        imageUrl: null,
        name: product.ProductName ?? product.ProductCode ?? "Unknown Product",
        description: null,
        qty: safeQty,
        unitPrice,
        discountType: "none",
        discountValue: 0,
        sortOrder: index + 1,
        lineSubtotal,
        lineDiscountTotal: 0,
        lineTotal: lineSubtotal,
        createdAt: now,
        updatedAt: now,
    };
}
async function fetchOneProduct(productCode) {
    const baseUrl = process.env.PRODUCT;
    console.log(baseUrl, 'baseUrl');
    if (!baseUrl) {
        throw new Error("Missing PRODUCT env var");
    }
    const url = `${baseUrl}${encodeURIComponent(productCode)}`;
    console.log(url, 'url');
    const response = await fetch(url);
    if (!response.ok)
        return null;
    const raw = await response.text();
    console.log(raw, 'raw');
    return parseVolusionResponse(raw);
}
async function fetchCartProductsAsQuoteItems(cartItems) {
    const results = await Promise.all(cartItems.map(async (item, index) => {
        const product = await fetchOneProduct(item.productCode);
        if (!product)
            return null;
        return toQuoteItem(product, item.qty, index);
    }));
    return results.filter((item) => item !== null);
}

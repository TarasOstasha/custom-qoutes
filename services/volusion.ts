import { resolveVolusionProductImageUrlWithFallbacks } from "../lib/normalizeProductImageUrl";
import { QuoteItem } from "../mock/quotes";

type CartItemInput = { productCode: string; qty: number };

type VolusionProduct = {
  ProductCode: string | undefined;
  ProductID: string | undefined;
  ProductName: string | undefined;
  Vendor_PartNo: string | undefined;
  Photos_Cloned_From: string | undefined;
  ProductPrice: string | number | undefined;
  Vendor_Price: string | number | undefined;
};

function tagValue(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim();
}

function parseVolusionResponse(raw: string): VolusionProduct | null {
  const trimmed = raw.trim();

  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    if (row && typeof row === "object") return row as VolusionProduct;
  } catch {
    // Non-JSON response; fall through to XML parser.
  }

  const tableBlockMatch = trimmed.match(/<Table[\s\S]*?<\/Table>/i);
  const block = tableBlockMatch?.[0] ?? trimmed;

  const product: VolusionProduct = {
    ProductCode: tagValue(block, "ProductCode"),
    ProductID: tagValue(block, "ProductID"),
    ProductName: tagValue(block, "ProductName"),
    Vendor_PartNo: tagValue(block, "Vendor_PartNo"),
    Photos_Cloned_From: tagValue(block, "Photos_Cloned_From"),
    ProductPrice: tagValue(block, "ProductPrice"),
    Vendor_Price: tagValue(block, "Vendor_Price"),
  };

  if (!product.ProductCode && !product.ProductName) return null;
  return product;
}

function toNumber(value: string | number | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function toQuoteItem(product: VolusionProduct, qty: number, index: number): Promise<QuoteItem> {
  const now = new Date().toISOString();
  const unitPrice = toNumber(product.ProductPrice ?? product.Vendor_Price, 0);
  const safeQty = toNumber(qty, 0);
  const lineSubtotal = Number((safeQty * unitPrice).toFixed(2));
  const productCode = product.ProductCode ?? product.Vendor_PartNo ?? "";
  const imageUrl = await resolveVolusionProductImageUrlWithFallbacks(
    product.ProductCode,
    product.Photos_Cloned_From,
  );

  return {
    id: `qi_cart_${Date.now()}_${index}`,
    quoteId: "",
    lineType: "product",
    sourceProductId: product.ProductID ?? null,
    sku: productCode || null,
    imageUrl,
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

async function fetchOneProduct(productCode: string): Promise<VolusionProduct | null> {
  const baseUrl = process.env.PRODUCT;
  console.log(baseUrl, 'baseUrl')
  if (!baseUrl) {
    throw new Error("Missing PRODUCT env var");
  }

  const url = `${baseUrl}${encodeURIComponent(productCode)}`;
  console.log(url, 'url')
  const response = await fetch(url);
  if (!response.ok) return null;
  const raw = await response.text();
  console.log(raw, 'raw')
  return parseVolusionResponse(raw);
}

export async function fetchCartProductsAsQuoteItems(
  cartItems: CartItemInput[]
): Promise<QuoteItem[]> {
  const results = await Promise.all(
    cartItems.map(async (item, index) => {
      const product = await fetchOneProduct(item.productCode);
      if (!product) return null;
      return await toQuoteItem(product, item.qty, index);
    })
  );

  return results.filter((item): item is QuoteItem => item !== null);
}

/** Types + pure parsers for Volusion Abandoned/Live Carts (CartIDLog). */

export type AbandonedCartLine = {
  productCode: string;
  optionIds: number[];
  qty: number;
  price?: number;
};

/** Normalize API/UI payloads into rebuild-ready cart lines. */
export function normalizeAbandonedCartLines(raw: unknown): AbandonedCartLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: AbandonedCartLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const productCode = String(record.productCode ?? record.product_code ?? "").trim();
    if (!productCode) continue;
    const optionIds = Array.isArray(record.optionIds)
      ? record.optionIds
          .map((value) => Number(value))
          .filter((n) => Number.isFinite(n) && n > 0)
          .map((n) => Math.trunc(n))
      : parseOptionIdsCsv(String(record.optionIds ?? record.option_ids ?? ""));
    const qtyRaw = Number(record.qty ?? record.quantity ?? 1);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.max(1, Math.trunc(qtyRaw)) : 1;
    const priceRaw = Number(record.price);
    const price = Number.isFinite(priceRaw) && priceRaw >= 0 ? priceRaw : undefined;
    lines.push({
      productCode,
      optionIds,
      qty,
      ...(price !== undefined ? { price } : {}),
    });
  }
  return lines;
}

export type AbandonedCartSummary = {
  cartId: string;
  email: string | null;
  itemCount: number | null;
  lastModified: string | null;
};

const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_RE = /^[0-9a-f]{32}$/i;

/** CartIDLog abandoned/live cart ids are UUID-with-dashes (not bare 32-hex placeholders). */
export function isAbandonedCartGuid(value: string): boolean {
  return GUID_RE.test(value.trim());
}

export function looksLikeCartId(value: string): boolean {
  const v = value.trim();
  return GUID_RE.test(v) || HEX32_RE.test(v);
}

/** Pull first UUID-looking token from a cookie/storage blob. */
export function extractAbandonedCartGuidFromText(raw: string): string | null {
  const match = String(raw ?? "").match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return match?.[0] ?? null;
}

export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/**
 * Parse comma-separated OptionIDs.
 * Accepts "6651,6349" and Volusion slash form "/232,/278,/273".
 */
export function parseOptionIdsCsv(raw: string | null | undefined): number[] {
  const source = String(raw ?? "").trim();
  if (!source) return [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of source.split(/[,;\s]+/)) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    // Volusion often prefixes option ids with "/" in CartIDLog ("/232,/278").
    const digits = cleaned.replace(/^\/+/, "").match(/^\d+$/)?.[0];
    if (!digits) continue;
    const n = Number(digits);
    if (!Number.isFinite(n) || n <= 0) continue;
    const id = Math.trunc(n);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function cellText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toPositiveNumber(value: unknown): number | null {
  const cleaned = cellText(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a Shopping Cart Contents header row + data cells into a line.
 * Expected headers (case-insensitive): ProductCode, OptionIDs, Price, QTY, LastModified.
 */
export function mapCartContentsRow(
  headers: string[],
  cells: string[],
): AbandonedCartLine | null {
  const indexByHeader = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = cellText(header).toLowerCase().replace(/[\s_]+/g, "");
    if (key) indexByHeader.set(key, index);
  });

  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const idx = indexByHeader.get(key);
      if (idx === undefined) continue;
      return cellText(cells[idx]);
    }
    return "";
  };

  const productCode = get("productcode", "product", "sku");
  if (!productCode) return null;

  const optionIds = parseOptionIdsCsv(get("optionids", "optionid", "options"));
  const qtyRaw = toPositiveNumber(get("qty", "quantity"));
  const qty = qtyRaw !== null && qtyRaw > 0 ? Math.max(1, Math.trunc(qtyRaw)) : 1;
  const priceRaw = toPositiveNumber(get("price", "productprice"));
  const price = priceRaw !== null && priceRaw >= 0 ? priceRaw : undefined;

  return {
    productCode,
    optionIds,
    qty,
    ...(price !== undefined ? { price } : {}),
  };
}

function isCartContentsHeaderRow(row: string[]): boolean {
  const normalized = row.map((cell) => cellText(cell).toLowerCase().replace(/[\s_]+/g, ""));
  return (
    normalized.includes("productcode") &&
    (normalized.includes("optionids") ||
      normalized.includes("optionid") ||
      normalized.includes("qty") ||
      normalized.includes("quantity"))
  );
}

/**
 * Parse HTML (or plain table text markup) of the admin cart detail
 * "Shopping Cart Contents" table into lines.
 */
export function parseAbandonedCartContentsHtml(html: string): AbandonedCartLine[] {
  const source = String(html ?? "");
  if (!source.trim()) return [];

  // Prefer the dedicated #ShoppingCartContents table (Volusion AdminDetails_Generic).
  const byIdMatch = source.match(
    /<table\b[^>]*\bid\s*=\s*["']ShoppingCartContents["'][^>]*>([\s\S]*?)<\/table>/i,
  );
  const sectionMatch = source.match(
    /Shopping\s+Cart\s+Contents[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/i,
  );
  const tableHtml =
    byIdMatch?.[1] ??
    sectionMatch?.[1] ??
    (() => {
      const anyTable = source.match(/<table\b[^>]*>([\s\S]*?ProductCode[\s\S]*?)<\/table>/i);
      return anyTable?.[1] ?? "";
    })();

  if (!tableHtml.trim()) return [];

  const rows: string[][] = [];
  for (const rowMatch of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1] ?? "";
    const cells: string[] = [];
    for (const cellMatch of rowHtml.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
      const text = cellText(
        String(cellMatch[1] ?? "")
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&"),
      );
      cells.push(text);
    }
    if (cells.some((c) => c)) rows.push(cells);
  }

  if (rows.length < 2) return [];

  const headerIdx = rows.findIndex((row) => isCartContentsHeaderRow(row));
  if (headerIdx < 0) return [];
  const headers = rows[headerIdx] ?? [];
  const lines: AbandonedCartLine[] = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const line = mapCartContentsRow(headers, rows[i] ?? []);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Parse a CartIDLog list row into a summary.
 * Typical columns: Cart, Customer, Phone, Email, IP, Cart Item Count, Last Modified.
 */
export function mapCartIdLogListRow(cells: string[]): AbandonedCartSummary | null {
  const texts = cells.map(cellText);
  if (!texts.length) return null;

  let cartId = "";
  let email: string | null = null;
  let itemCount: number | null = null;
  let lastModified: string | null = null;

  for (const text of texts) {
    if (!cartId && looksLikeCartId(text)) {
      cartId = text;
      continue;
    }
    if (!email && looksLikeEmail(text)) {
      email = text;
      continue;
    }
    // Item count: small integer column (not a year, not a phone-like number)
    if (itemCount === null && /^\d{1,3}$/.test(text)) {
      const n = Number(text);
      if (n >= 0 && n <= 500) itemCount = n;
      continue;
    }
    // Last modified-ish datetime
    if (!lastModified && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text) && /\d/.test(text)) {
      lastModified = text;
    }
  }

  if (!cartId) return null;
  return { cartId, email, itemCount, lastModified };
}

export function filterCartSummariesByEmail(
  carts: AbandonedCartSummary[],
  email: string,
): AbandonedCartSummary[] {
  const needle = email.trim().toLowerCase();
  if (!needle) return [];
  return carts.filter((cart) => (cart.email ?? "").trim().toLowerCase() === needle);
}

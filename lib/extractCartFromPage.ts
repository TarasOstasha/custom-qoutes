import { normalizeProductImageUrl } from "./normalizeProductImageUrl";
import { reconcileShippingSelectionWithTotal } from "./shippingMethod";

const DEFAULT_CART_ID = "07387C5E1E344F7DB151AE80E9894EE7";

export type CartItemRow = {
  /** Volusion cart row id when present in DOM; otherwise set during scrape fallback. */
  cartLineId?: string;
  productCode: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl?: string;
  options?: string[];
  /** Help_CartItemDetails.asp or .php path used to load the options popup. */
  optionsPopupPath?: string;
};

export type CartShippingOption = {
  value: string;
  label: string;
  price?: number;
  selected?: boolean;
};

export type CartPayload = {
  cartId: string;
  cartItems: CartItemRow[];
  shippingTotal: number;
  shippingState?: string;
  shippingZip?: string;
  shippingLabel?: string | null;
  shippingOptions?: CartShippingOption[];
  selectedShippingValue?: string;
  selectedShippingOption?: CartShippingOption | null;
  taxTotal: number;
  /** e.g. "NJ Sales Tax (6.625%)" from `.v65-cart-taxtext-cell` */
  taxDescription?: string;
  grandTotal: number;
};

/**
 * Full cart DOM parse — self-contained so Playwright can `page.evaluate(this)`.
 * Do not reference module-level bindings inside (serialization runs in page context).
 */
export async function extractCartPayloadInBrowser(): Promise<CartPayload> {
  const DEFAULT_ID = "07387C5E1E344F7DB151AE80E9894EE7";
  const ABSOLUTE_ASSET_BASE = "https://www.xyzdisplays.com";

  /** Prefer last `$12.34` token so labels like "UPS 3 Day Select $252.45" do not concatenate stray digits. */
  function parseMoney(text: string): number {
    const s = String(text ?? "");
    const dollarMatches = [...s.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g)];
    if (dollarMatches.length > 0) {
      const last = dollarMatches[dollarMatches.length - 1]?.[1];
      const n = parseFloat(String(last).replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
    const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  function productCodeFromLink(anchor: HTMLAnchorElement | null): string {
    if (!anchor?.href) return "";
    try {
      const u = new URL(anchor.href, window.location.origin);
      const code =
        u.searchParams.get("ProductCode") ??
        u.searchParams.get("productcode") ??
        u.searchParams.get("Product_Code") ??
        "";
      if (code) return code.trim();
    } catch {
      /* fall through */
    }
    const m = anchor.href.match(/[?&]ProductCode=([^&]+)/i);
    return m?.[1] ? decodeURIComponent(m[1]) : "";
  }

  function findCartTable(): HTMLTableElement | null {
    const selectors = [
      "#v65-cart-table",
      "table#v65-cart-table",
      'form[action*="ShoppingCart"] table',
      'form[name="Cart"] table',
      "table.v65-cart-table",
      '[id*="cart-table"]',
      '[class*="cart-table"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.tagName === "TABLE") return el as HTMLTableElement;
    }
    const tables = document.querySelectorAll("table");
    for (const t of tables) {
      if (t.querySelector('input[id^="Quantity"], input[name^="Quantity"]')) {
        const text = (t.textContent ?? "").toUpperCase();
        if (/\bEACH\b/.test(text) && /\bTOTAL\b/.test(text) && /\bQTY\b/.test(text)) {
          return t as HTMLTableElement;
        }
      }
    }
    for (const t of tables) {
      const text = (t.textContent ?? "").toUpperCase();
      if (/\bEACH\b/.test(text) && /\bTOTAL\b/.test(text) && /\bQTY\b/.test(text)) {
        return t as HTMLTableElement;
      }
    }
    return null;
  }

  function thIndex(ths: NodeListOf<HTMLTableCellElement>, matcher: (t: string) => boolean): number {
    for (let i = 0; i < ths.length; i += 1) {
      const cell = ths.item(i);
      if (!cell) continue;
      const t = (cell.textContent ?? "").replace(/\s+/g, " ").trim();
      if (matcher(t.toUpperCase())) return i;
    }
    return -1;
  }

  function readQtyFromRow(tr: HTMLTableRowElement): number {
    const selectors = [
      'input[id^="Quantity"]',
      'input[id*="Quantity"]',
      'input[name^="Quantity"]',
      'input[name*="Quantity"]',
      'input[id*="quantity"]',
    ];
    for (const sel of selectors) {
      const inp = tr.querySelector(sel) as HTMLInputElement | null;
      if (inp) {
        const q = Number(inp.value);
        if (Number.isFinite(q) && q > 0) return q;
      }
    }
    return 1;
  }

  function isImportableCartRow(_tr: HTMLTableRowElement, unitPrice: number, lineTotal: number): boolean {
    return unitPrice > 0 || lineTotal > 0;
  }

  function columnOffset(thCount: number, tdCount: number): number {
    if (tdCount > thCount) return tdCount - thCount;
    return 0;
  }

  function pickProductImageSrc(row: Element): string | undefined {
    const imgs = Array.from(row.querySelectorAll("td img"));
    const candidates = imgs
      .map((img) => (img.getAttribute("src") ?? "").trim())
      .filter(Boolean);
    if (!candidates.length) return undefined;

    const prefer = candidates.find((src) => /\/vspfiles\//i.test(src) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(src));
    return prefer ?? candidates[0];
  }

  function toAbsoluteUrl(src: string): string {
    try {
      return new URL(src, ABSOLUTE_ASSET_BASE).href;
    } catch {
      return src;
    }
  }

  function normalizeText(text: string): string {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }

  function lineCartIdFromProductLinks(scope: ParentNode | null | undefined): string {
    if (!scope) return "";
    const links = Array.from(
      scope.querySelectorAll('a[href*="ProductCode"], a[href*="productcode"], a[href*="ProductDetails"]'),
    ) as HTMLAnchorElement[];
    for (const link of links) {
      const href = (link.getAttribute("href") ?? "").replace(/&amp;/g, "&");
      try {
        const url = new URL(href, window.location.href);
        const cartId =
          url.searchParams.get("CartID")?.trim() ||
          url.searchParams.get("CartId")?.trim() ||
          url.searchParams.get("cartid")?.trim() ||
          "";
        if (cartId) return cartId;
      } catch {
        const match = href.match(/[?&]CartID=([^&]+)/i);
        if (match?.[1]) return decodeURIComponent(match[1]);
      }
    }
    return "";
  }

  function popupDetailsPathFromAnchor(
    anchor: HTMLAnchorElement | null,
    row?: HTMLTableRowElement | null,
  ): string {
    if (!anchor) return "";
    const hrefRaw = anchor.getAttribute("href") ?? "";
    const onclickRaw = anchor.getAttribute("onclick") ?? "";
    const combined = `${hrefRaw} ${onclickRaw}`;
    const raw =
      [hrefRaw, onclickRaw, combined].find((x) => /Help_CartItemDetails\.(?:asp|php)/i.test(x)) ?? "";
    if (raw) {
      const decoded = raw.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const openWindowMatch = decoded.match(/OpenNewWindow\(\s*['"]([^'"]+)['"]/i);
      const directPathMatch = decoded.match(/(Help_CartItemDetails\.(?:asp|php)(?:\?[^'"\s)]*)?)/i);
      const path = (openWindowMatch?.[1] ?? directPathMatch?.[1] ?? "").replace(/&amp;/g, "&");
      if (path.trim()) return path.trim();
    }

    // Newer Volusion themes use javascript:void(0) and JS loads Help_CartItemDetails.php?CartID=<line>.
    // The line id lives on the nearby ProductDetails.php?ProductCode=...&CartID=N link in the same cell.
    const looksLikeOptionsLink = /view list of options/i.test(
      `${anchor.getAttribute("title") ?? ""} ${anchor.textContent ?? ""}`,
    );
    if (!looksLikeOptionsLink && !/javascript:\s*void\s*\(\s*0\s*\)/i.test(hrefRaw)) return "";

    const sameCell = anchor.closest("td");
    const scope: ParentNode | null =
      sameCell ??
      row ??
      (anchor.closest("tr") as HTMLTableRowElement | null);
    const lineCartId = lineCartIdFromProductLinks(scope);
    if (lineCartId) return `Help_CartItemDetails.php?CartID=${encodeURIComponent(lineCartId)}`;

    const qtyScope = (row as ParentNode | null) ?? scope;
    const qtyInput = qtyScope?.querySelector(
      'input[id^="Quantity"], input[name^="Quantity"], input[id*="Quantity"], input[name*="Quantity"]',
    ) as HTMLInputElement | null;
    if (qtyInput) {
      const idName = `${qtyInput.id ?? ""} ${qtyInput.name ?? ""}`;
      const suffixMatch = idName.match(/(?:Quantity|quantity)[_\-]?(\d+)/i);
      if (suffixMatch?.[1]) {
        return `Help_CartItemDetails.php?CartID=${encodeURIComponent(suffixMatch[1])}`;
      }
    }

    return "";
  }

  function cartLineIdFromRow(
    tr: HTMLTableRowElement,
    popupPath: string,
    rowIndex: number,
    productCode: string,
    unitPrice: number,
    lineTotal: number,
  ): string {
    if (popupPath) {
      try {
        const popupUrl = new URL(popupPath, window.location.href);
        for (const key of [
          "CartItemID",
          "CartItemId",
          "cartitemid",
          "CartID",
          "CartId",
          "cartid",
          "ID",
          "Id",
          "ItemID",
          "itemid",
        ]) {
          const value = popupUrl.searchParams.get(key)?.trim();
          if (value) {
            const priceKey = Math.round(unitPrice * 100);
            return `volusion_${value}_p${priceKey}`;
          }
        }
      } catch {
        /* fall through */
      }
    }

    const hiddenSelectors = [
      'input[name*="CartItem"]',
      'input[id*="CartItem"]',
      'input[name*="cartitem"]',
      'input[id*="cartitem"]',
    ];
    for (const selector of hiddenSelectors) {
      const input = tr.querySelector(selector) as HTMLInputElement | null;
      const value = input?.value?.trim();
      if (value) {
        const priceKey = Math.round(unitPrice * 100);
        return `volusion_${value}_p${priceKey}`;
      }
    }

    const qtyInput = tr.querySelector(
      'input[id^="Quantity"], input[name^="Quantity"], input[id*="Quantity"], input[name*="Quantity"]',
    ) as HTMLInputElement | null;
    if (qtyInput) {
      const idName = `${qtyInput.id ?? ""} ${qtyInput.name ?? ""}`;
      const suffixMatch = idName.match(/(?:Quantity|quantity)[_\-]?(\d+)/i);
      if (suffixMatch?.[1]) return `volusion_qty_${suffixMatch[1]}`;
    }

    const code = (productCode || "item").toLowerCase();
    const pathKey = popupPath
      ? popupPath.replace(/\W+/g, "_").slice(0, 80)
      : `row${rowIndex}`;
    return `import_${code}_r${rowIndex}_p${Math.round(unitPrice * 100)}_t${Math.round(lineTotal * 100)}_${pathKey}`;
  }

  function findOptionsAnchorInRow(tr: HTMLTableRowElement): HTMLAnchorElement | null {
    const directSelectors = [
      'a[href*="Help_CartItemDetails.php"]',
      'a[href*="Help_CartItemDetails.asp"]',
      'a[onclick*="Help_CartItemDetails.php"]',
      'a[onclick*="Help_CartItemDetails.asp"]',
      'a[href*="Help_CartItemDetails"]',
      'a[onclick*="Help_CartItemDetails"]',
      'a[title*="View list of options"]',
    ];
    for (const selector of directSelectors) {
      const el = tr.querySelector(selector) as HTMLAnchorElement | null;
      if (el) return el;
    }

    const openWindowLinks = Array.from(
      tr.querySelectorAll('a[href*="OpenNewWindow"], a[onclick*="OpenNewWindow"]'),
    ) as HTMLAnchorElement[];
    for (const el of openWindowLinks) {
      const raw = `${el.getAttribute("href") ?? ""} ${el.getAttribute("onclick") ?? ""}`;
      if (/Help_CartItemDetails\.(?:asp|php)/i.test(raw)) return el;
    }

    const byLabel = Array.from(tr.querySelectorAll("a")).find((el) =>
      /view list of options/i.test(`${el.getAttribute("title") ?? ""} ${el.textContent ?? ""}`),
    ) as HTMLAnchorElement | undefined;
    if (byLabel) return byLabel;

    return null;
  }

  /** True when this row starts a new priced cart line (not an options sub-row). */
  function isNextCartLineRow(tr: HTMLTableRowElement): boolean {
    const tds = tr.querySelectorAll("td");
    for (let i = 0; i < tds.length; i += 1) {
      const td = tds.item(i);
      if (!td) continue;
      const txt = td.textContent ?? "";
      if (/\$\s*[\d,]+/.test(txt) && !td.querySelector("input")) {
        const value = parseMoney(txt);
        if (value > 0) return true;
      }
    }
    const qtyInput = tr.querySelector(
      'input[id^="Quantity"], input[name^="Quantity"]',
    ) as HTMLInputElement | null;
    if (qtyInput && (qtyInput.type ?? "text").toLowerCase() !== "hidden") return true;
    return false;
  }

  function findOptionsAnchorNearRow(rows: HTMLTableRowElement[], rowIndex: number): HTMLAnchorElement | null {
    const current = rows[rowIndex];
    if (!current) return null;

    const inCurrent = findOptionsAnchorInRow(current);
    if (inCurrent) return inCurrent;

    for (let i = rowIndex + 1; i < Math.min(rows.length, rowIndex + 5); i += 1) {
      const next = rows[i];
      if (!next) break;
      // Option sub-rows repeat product name/links — stop before the next priced cart line
      // so we do not steal that line's "View list of options" link.
      if (isNextCartLineRow(next)) break;
      const candidate = findOptionsAnchorInRow(next);
      if (candidate) return candidate;
    }
    return null;
  }

  async function scrapeOptionsFromPopupPath(path: string): Promise<string[]> {
    const trimmedPath = path.trim();
    if (!trimmedPath) return [];

    try {
      const url = new URL(trimmedPath, window.location.href).href;
      const response = await fetch(url, {
        credentials: "include",
        redirect: "follow",
      });
      if (!response.ok) return [];
      const html = await response.text();
      const popupDoc = new DOMParser().parseFromString(html, "text/html");

      const options: string[] = [];
      const seen = new Set<string>();
      const rawBodyText = popupDoc.body?.textContent ?? "";
      const rawBodyHtml = popupDoc.body?.innerHTML ?? "";

      const linesFromHtml = (html: string): string[] => {
        const withBreaks = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|tr|h[1-6]|td|blockquote)>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'");
        return withBreaks
          .split(/\r?\n+/)
          .map((line) => normalizeText(line))
          .filter(Boolean);
      };

      const parseOptionLines = (lines: string[]): string[] => {
        const parsed: string[] = [];
        for (const rawLine of lines) {
          if (/^your options for\s*:/i.test(rawLine)) continue;
          if (/^item\s*(name|price)\s*:?/i.test(rawLine)) {
            if (parsed.length) break;
            continue;
          }
          const line = rawLine.replace(/^(your\s+)?options(\s+for)?\s*:\s*/i, "").trim();
          if (!line || /^options$/i.test(line)) continue;
          const pairMatch = line.match(/^([^:]{1,80})\s*:\s*(.+)$/);
          if (pairMatch) {
            const label = normalizeText(pairMatch[1] ?? "");
            const value = normalizeText(pairMatch[2] ?? "");
            if (/^your options for$/i.test(label)) continue;
            if (/^item\s*(name|price)$/i.test(label)) continue;
            if (label && value) {
              parsed.push(`${label}: ${value}`);
              continue;
            }
          }
          if (parsed.length > 0 && !/^options$/i.test(rawLine)) {
            const last = parsed[parsed.length - 1] ?? "";
            parsed[parsed.length - 1] = `${last} ${line}`.trim();
          }
        }
        return parsed;
      };

      const extractFromOptionsSection = (rawText: string): string[] => {
        const lines = rawText
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const startIndex = lines.findIndex((line) => /^(your\s+)?options(\s+for)?\s*:?/i.test(line));
        if (startIndex < 0) return [];
        return parseOptionLines(lines.slice(startIndex));
      };

      const addOptions = (list: string[]) => {
        list.forEach((opt) => {
          if (!opt || seen.has(opt)) return;
          seen.add(opt);
          options.push(opt);
        });
      };

      addOptions(extractFromOptionsSection(rawBodyText));
      if (options.length > 0) return options;
      addOptions(parseOptionLines(linesFromHtml(rawBodyHtml)));
      if (options.length > 0) return options;

      const rows = Array.from(popupDoc.querySelectorAll("tr"));
      rows.forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("td")).map((td) => normalizeText(td.textContent ?? ""));
        const nonEmptyCells = cells.filter(Boolean);
        if (nonEmptyCells.length < 2) return;
        const label = (nonEmptyCells[0] ?? "").replace(/:$/, "").trim();
        const value = nonEmptyCells.slice(1).join(" ").trim();
        if (!label || !value) return;
        if (/^item\s*(name|price)$/i.test(label)) return;
        if (/^options$/i.test(label)) {
          const nestedOptions = extractFromOptionsSection(`Options: ${value}`);
          nestedOptions.forEach((opt) => {
            if (!opt || seen.has(opt)) return;
            seen.add(opt);
            options.push(opt);
          });
          return;
        }
        const optionText = `${label}: ${value}`;
        if (seen.has(optionText)) return;
        seen.add(optionText);
        options.push(optionText);
      });

      if (options.length > 0) return options;

      // Some themes render options as plain lists instead of table rows.
      popupDoc.querySelectorAll("li").forEach((li) => {
        const text = normalizeText(li.textContent ?? "");
        if (!text) return;
        if (seen.has(text)) return;
        seen.add(text);
        options.push(text);
      });

      return options;
    } catch {
      return [];
    }
  }

  let cartId = DEFAULT_ID;
  const params = new URLSearchParams(window.location.search);
  const fromQuery =
    params.get("CartID")?.trim() ||
    params.get("cartid")?.trim() ||
    params.get("cartId")?.trim() ||
    "";
  if (fromQuery) cartId = fromQuery;

  const hid = document.querySelector(
    'input[name="CartID"], input[name="CartID5"], input[name="cartid"], input[name="CartId"], #CartID'
  ) as HTMLInputElement | null;
  if (hid?.value?.trim()) cartId = hid.value.trim();

  // Prefer Abandoned/Live Cart UUID from cookies / storage when present.
  try {
    const guidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const pickGuid = (raw: string): string | null => {
      try {
        const decoded = decodeURIComponent(raw);
        const m = decoded.match(guidRe);
        return m?.[0] ?? null;
      } catch {
        const m = raw.match(guidRe);
        return m?.[0] ?? null;
      }
    };
    for (const part of String(document.cookie ?? "").split(";")) {
      const value = part.split("=").slice(1).join("=").trim();
      const found = pickGuid(value);
      if (found) {
        cartId = found;
        break;
      }
    }
    if (!guidRe.test(cartId)) {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        const found = pickGuid(localStorage.getItem(key) ?? "") || pickGuid(key);
        if (found) {
          cartId = found;
          break;
        }
      }
    }
  } catch {
    /* ignore storage access errors */
  }

  const table = findCartTable();
  const cartItems: CartItemRow[] = [];

  if (table) {
    const headerRow = table.querySelector("thead tr");
    const ths = headerRow?.querySelectorAll("th") ?? ([] as unknown as NodeListOf<HTMLTableCellElement>);
    const thList = headerRow ? Array.from(headerRow.querySelectorAll("th")) : [];

    let eachIdx = thIndex(ths as NodeListOf<HTMLTableCellElement>, (u) => /\bEACH\b/.test(u));
    let totalIdx = thIndex(ths as NodeListOf<HTMLTableCellElement>, (u) => /\bTOTAL\b/.test(u));
    if (eachIdx < 0) {
      eachIdx = thList.findIndex((th) => /\bEACH\b/i.test(th.textContent ?? ""));
    }
    if (totalIdx < 0) {
      totalIdx = thList.findIndex((th) => /\bTOTAL\b/i.test(th.textContent ?? ""));
    }

    let bodyRows = table.querySelectorAll("tbody tr");
    if (!bodyRows.length) {
      bodyRows = table.querySelectorAll("tr");
    }
    const rowList = Array.from(bodyRows).filter((tr) => !tr.closest("thead")) as HTMLTableRowElement[];
    const optionsByLineId = new Map<string, string[]>();

    for (let rowIndex = 0; rowIndex < rowList.length; rowIndex += 1) {
      const tr = rowList[rowIndex];
      if (!tr) continue;
      if (tr.closest("thead")) continue;

      const nameEl =
        tr.querySelector(".cart-item-name") ??
        tr.querySelector('td a[href*="Product"]') ??
        tr.querySelector('td a[href*="ProductDetails"]') ??
        tr.querySelector('td a[href*=".php"]') ??
        tr.querySelector('td a[href*=".asp"]');

      const link =
        (tr.querySelector('a[href*="ProductCode"]') as HTMLAnchorElement | null) ??
        (tr.querySelector('a[href*="productcode"]') as HTMLAnchorElement | null) ??
        (nameEl?.tagName === "A" ? (nameEl as HTMLAnchorElement) : nameEl?.querySelector("a"));

      const productCode = productCodeFromLink(link ?? null);
      const name = (nameEl?.textContent ?? link?.textContent ?? "").trim();

      if (!productCode && !name) continue;

      const qty = readQtyFromRow(tr as HTMLTableRowElement);

      const tds = tr.querySelectorAll("td");
      const tdCount = tds.length;
      const thCount = thList.length || ths.length;
      const off = columnOffset(thCount, tdCount);

      let unitPrice = 0;
      let lineTotal = 0;

      const eachTdIdx = eachIdx >= 0 ? eachIdx + off : -1;
      const totalTdIdx = totalIdx >= 0 ? totalIdx + off : -1;

      if (eachTdIdx >= 0 && eachTdIdx < tdCount) {
        unitPrice = parseMoney(tds.item(eachTdIdx)?.textContent ?? "");
      }
      if (totalTdIdx >= 0 && totalTdIdx < tdCount) {
        lineTotal = parseMoney(tds.item(totalTdIdx)?.textContent ?? "");
      }

      if (unitPrice === 0 && lineTotal === 0) {
        const moneyCells: number[] = [];
        tds.forEach((td) => {
          const txt = td.textContent ?? "";
          if (/\$\s*[\d,]+/.test(txt) && !td.querySelector("input")) {
            const v = parseMoney(txt);
            if (v > 0) moneyCells.push(v);
          }
        });
        if (moneyCells.length >= 2) {
          unitPrice = moneyCells[0] ?? 0;
          lineTotal = moneyCells[moneyCells.length - 1] ?? 0;
        } else if (moneyCells.length === 1) {
          lineTotal = moneyCells[0] ?? 0;
          if (qty > 0) unitPrice = round2(lineTotal / qty);
        }
      } else if (unitPrice > 0 && lineTotal === 0 && qty > 0) {
        lineTotal = round2(unitPrice * qty);
      }

      if (!isImportableCartRow(tr as HTMLTableRowElement, unitPrice, lineTotal)) {
        continue;
      }

      const imageUrl = pickProductImageSrc(tr);
      const abs = imageUrl ? toAbsoluteUrl(imageUrl) : undefined;

      const optionsAnchor = findOptionsAnchorNearRow(rowList, rowIndex);
      let popupPath = popupDetailsPathFromAnchor(optionsAnchor, tr as HTMLTableRowElement);
      if (!popupPath) {
        // Kit/theme rows sometimes expose CartID on the product link even when the
        // options anchor is javascript:void(0) without an inline Help_* URL.
        const lineCartId = lineCartIdFromProductLinks(tr);
        const hasOptionsCue =
          Boolean(optionsAnchor) ||
          /view list of options/i.test(tr.textContent ?? "");
        if (lineCartId && hasOptionsCue) {
          popupPath = `Help_CartItemDetails.php?CartID=${encodeURIComponent(lineCartId)}`;
        }
      }
      const cartLineId = cartLineIdFromRow(
        tr as HTMLTableRowElement,
        popupPath,
        rowIndex,
        productCode,
        unitPrice,
        lineTotal,
      );
      let options: string[] = [];
      if (popupPath) {
        const optionsCacheKey = `${cartLineId}|${popupPath}`;
        if (optionsByLineId.has(optionsCacheKey)) {
          options = optionsByLineId.get(optionsCacheKey) ?? [];
        } else {
          options = await scrapeOptionsFromPopupPath(popupPath);
          if (options.length) {
            optionsByLineId.set(optionsCacheKey, options);
          }
        }
      }

      cartItems.push({
        cartLineId,
        productCode: productCode || name,
        name: name || productCode,
        qty,
        unitPrice,
        lineTotal,
        ...(abs ? { imageUrl: abs } : {}),
        ...(options.length ? { options } : {}),
        ...(popupPath ? { optionsPopupPath: popupPath } : {}),
      });
    }
  }

  if (!cartItems.length) {
    const seen = new Set<HTMLTableRowElement>();
    let fallbackRowIndex = 0;
    document.querySelectorAll('input[id^="Quantity"], input[name^="Quantity"]').forEach((inp) => {
      const tr = inp.closest("tr");
      if (!tr || tr.closest("thead") || seen.has(tr as HTMLTableRowElement)) return;
      seen.add(tr as HTMLTableRowElement);
      const rowIndex = fallbackRowIndex;
      fallbackRowIndex += 1;
      const nameEl =
        tr.querySelector(".cart-item-name") ??
        tr.querySelector('td a[href*="Product"]') ??
        tr.querySelector('td a[href*="ProductDetails"]') ??
        tr.querySelector('td a[href*=".php"]') ??
        tr.querySelector('td a[href*=".asp"]');
      const link =
        (tr.querySelector('a[href*="ProductCode"]') as HTMLAnchorElement | null) ??
        (tr.querySelector('a[href*="productcode"]') as HTMLAnchorElement | null) ??
        (nameEl?.tagName === "A" ? (nameEl as HTMLAnchorElement) : nameEl?.querySelector("a"));
      const productCode = productCodeFromLink(link ?? null);
      const name = (nameEl?.textContent ?? link?.textContent ?? "").trim();
      if (!productCode && !name) return;
      const qty = readQtyFromRow(tr as HTMLTableRowElement);
      const tds = tr.querySelectorAll("td");
      const moneyCells: number[] = [];
      tds.forEach((td) => {
        const txt = td.textContent ?? "";
        if (/\$\s*[\d,]+/.test(txt) && !td.querySelector("input")) {
          const v = parseMoney(txt);
          if (v > 0) moneyCells.push(v);
        }
      });
      let unitPrice = 0;
      let lineTotal = 0;
      if (moneyCells.length >= 2) {
        unitPrice = moneyCells[0] ?? 0;
        lineTotal = moneyCells[moneyCells.length - 1] ?? 0;
      } else if (moneyCells.length === 1) {
        lineTotal = moneyCells[0] ?? 0;
        if (qty > 0) unitPrice = round2(lineTotal / qty);
      }
      const imageUrl = pickProductImageSrc(tr);
      const abs = imageUrl ? toAbsoluteUrl(imageUrl) : undefined;
      const cartLineId = cartLineIdFromRow(
        tr as HTMLTableRowElement,
        "",
        rowIndex,
        productCode,
        unitPrice,
        lineTotal,
      );
      cartItems.push({
        cartLineId,
        productCode: productCode || name,
        name: name || productCode,
        qty,
        unitPrice,
        lineTotal,
        ...(abs ? { imageUrl: abs } : {}),
      });
    });
  }

  let taxTotal = 0;
  let shippingTotal = 0;

  // Volusion: tax row variants used in cart summary.
  const volTaxRow = document.querySelector("tr.v65-cart-tax-row, tr.v65-cart-tax-parent-row");
  let taxDescription = "";
  if (volTaxRow) {
    const amt =
      volTaxRow.querySelector("td.v65-cart-tax-cell, .v65-cart-tax-value, #v65-cart-tax-cell") ??
      volTaxRow.querySelector("td:last-of-type");
    const v = parseMoney((amt as HTMLElement | null)?.textContent ?? volTaxRow.textContent ?? "");
    if (v > 0) taxTotal = v;
  }

  function extractTaxDescription(): string {
    const labelEl = document.querySelector(".v65-cart-taxtext-cell b");
    if (labelEl) {
      let text = normalizeText(labelEl.textContent ?? "");
      text = text.replace(/:\s*$/, "").trim();
      if (text) return text;
    }
    if (volTaxRow) {
      const fallback =
        volTaxRow.querySelector(".v65-cart-taxtext-cell b") ??
        volTaxRow.querySelector(".v65-cart-taxtext-cell");
      if (fallback) {
        let text = normalizeText(fallback.textContent ?? "");
        text = text.replace(/:\s*$/, "").trim();
        if (text && /tax/i.test(text)) return text;
      }
    }
    return "";
  }

  taxDescription = extractTaxDescription();

  // Optional: some themes expose the rate in a dedicated node (avoid scraping the whole shipping widget).
  if (shippingTotal === 0) {
    const rateEl = document.querySelector(
      "#v65-cart-shipping-details .v65-cart-shipping-rate, .v65-cart-shipping-rate, #v65-cart-shipping-rate"
    );
    if (rateEl) {
      const v = parseMoney(rateEl.textContent ?? "");
      if (v > 0) shippingTotal = v;
    }
  }

  document.querySelectorAll("tr").forEach((tr) => {
    const txt = tr.textContent ?? "";
    if (/\bSales Tax\b/i.test(txt)) {
      if (!taxDescription) {
        const stateMatch = txt.match(/\b([A-Z]{2})\s+Sales Tax\b/i);
        if (stateMatch?.[1]) taxDescription = `${stateMatch[1].toUpperCase()} Sales Tax`;
      }
      if (taxTotal === 0) {
        const cells = tr.querySelectorAll("td");
        const last = cells[cells.length - 1];
        if (last) {
          const v = parseMoney(last.textContent ?? "");
          if (v > 0) taxTotal = v;
        }
      }
    }

    // Strict shipping row detection to avoid matching "Calculate Shipping" widgets.
    const firstCellText = (tr.querySelector("th, td")?.textContent ?? "").trim();
    const isShippingLabel = /^shipping\s*:?\s*$/i.test(firstCellText);
    if (shippingTotal === 0 && isShippingLabel) {
      const cells = tr.querySelectorAll("td");
      const last = cells[cells.length - 1];
      if (last) {
        const v = parseMoney(last.textContent ?? "");
        if (v > 0) shippingTotal = v;
      }
    }
  });

  let grandTotal = 0;
  const estimateCell = document.querySelector("#v65-cart-total-estimate-cell");
  if (estimateCell) {
    grandTotal = parseMoney(estimateCell.textContent ?? "");
  }
  if (grandTotal === 0) {
    document.querySelectorAll("tr, td, div, strong, span").forEach((el) => {
      const t = el.textContent ?? "";
      if (/^\s*Total:\s*\$/i.test(t) || (/Total/i.test(t) && /\$\s*[\d,]+/.test(t) && t.length < 80)) {
        const v = parseMoney(t);
        if (v > grandTotal) grandTotal = v;
      }
    });
  }
  if (grandTotal === 0) {
    const totalRow = Array.from(document.querySelectorAll("tr")).find((tr2) => {
      const x = tr2.textContent ?? "";
      return /^\s*Total\s*:/i.test(x.trim()) || /^Total$/i.test((tr2.querySelector("td,th")?.textContent ?? "").trim());
    });
    if (totalRow) {
      const cells = totalRow.querySelectorAll("td");
      const last = cells[cells.length - 1];
      if (last) grandTotal = parseMoney(last.textContent ?? "");
    }
  }

  const itemsTotal = round2(cartItems.reduce((sum, row) => sum + (Number.isFinite(row.lineTotal) ? row.lineTotal : 0), 0));

  // Reconcile fees against displayed total so shipping/tax stay consistent with storefront math.
  if (grandTotal > 0) {
    const feesExpected = round2(grandTotal - itemsTotal);
    if (feesExpected >= 0) {
      const feesCurrent = round2(shippingTotal + taxTotal);
      const mismatch = Math.abs(feesCurrent - feesExpected);
      if (mismatch > 0.02) {
        if (taxTotal > 0 && shippingTotal === 0) {
          shippingTotal = round2(Math.max(0, feesExpected - taxTotal));
        } else if (shippingTotal > 0 && taxTotal === 0) {
          taxTotal = round2(Math.max(0, feesExpected - shippingTotal));
        } else {
          shippingTotal = round2(Math.max(0, feesExpected - taxTotal));
        }
      }
    }
  }

  // Fallback shipping inference: total - items - tax.
  if (shippingTotal === 0 && grandTotal > 0) {
    const inferred = round2(grandTotal - itemsTotal - taxTotal);
    shippingTotal = inferred > 0 ? inferred : 0;
  }

  function parseShippingDestination(text: string): { state: string; zip: string } {
    const raw = normalizeText(text);
    if (!raw) return { state: "", zip: "" };
    const zipMatch = raw.match(/\b(\d{5}(?:-\d{4})?)\b/);
    const zip = zipMatch?.[1] ?? "";
    let rest = raw;
    if (zip) rest = rest.replace(zip, "").replace(/[,\s]+$/, "").trim();
    const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
    let state = "";
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (/^[A-Za-z]{2}$/.test(parts[i] ?? "")) {
        state = (parts[i] ?? "").toUpperCase();
        break;
      }
    }
    return { state, zip };
  }

  function extractShippingDestination(): { state: string; zip: string } {
    const roots = [
      document.querySelector("#v65-cart-shipping-details"),
      document.querySelector("#v65-cart-shipping-details-wrapper #v65-cart-shipping-details"),
      document.querySelector("#v65-cart-shipping-details-wrapper"),
    ].filter((el): el is Element => Boolean(el));

    for (const root of roots) {
      for (const td of Array.from(root.querySelectorAll("td"))) {
        const text = normalizeText(td.textContent ?? "");
        if (!text || text.length > 120 || !/\b\d{5}(?:-\d{4})?\b/.test(text)) continue;
        const parsed = parseShippingDestination(text);
        if (parsed.state || parsed.zip) return parsed;
      }
    }
    return { state: "", zip: "" };
  }

  const { state: shippingState, zip: shippingZip } = extractShippingDestination();

  // Inline Volusion ShippingSpeedChoice scrape (must stay self-contained for page.evaluate).
  const shippingSpeedExtras = (() => {
    function findShippingSpeedSelect(): HTMLSelectElement | null {
      const queries = [
        '#v65-cart-shipping-details select[name="ShippingSpeedChoice"]',
        '#v65-cart-shipping-details select.browser-default[name="ShippingSpeedChoice"]',
        "#v65-cart-shipping-details-wrapper select[name=\"ShippingSpeedChoice\"]",
        "td.v65-cart-shipping-details-input-cell select[name=\"ShippingSpeedChoice\"]",
        'select.browser-default[name="ShippingSpeedChoice"]',
        'select[name="ShippingSpeedChoice"]',
      ];
      for (const query of queries) {
        const el = document.querySelector(query);
        if (el instanceof HTMLSelectElement && el.options.length > 0) return el;
      }
      return null;
    }

    function shippingOptionLabel(option: HTMLOptionElement): string {
      return (option.label || option.textContent || "").replace(/\s+/g, " ").trim();
    }

    function isPleaseSelect(option: HTMLOptionElement | null): boolean {
      if (!option) return true;
      const value = (option.value ?? "").trim();
      const label = shippingOptionLabel(option);
      return !value || value === "0" || /^please\s*select/i.test(label);
    }

    function optionIsMarkedSelected(option: HTMLOptionElement): boolean {
      if (option.selected) return true;
      if (option.hasAttribute("selected")) return true;
      const attr = (option.getAttribute("selected") ?? "").trim().toLowerCase();
      return attr !== "" && attr !== "false";
    }

    function findSelectedOption(select: HTMLSelectElement): HTMLOptionElement | null {
      for (const option of Array.from(select.options)) {
        if (optionIsMarkedSelected(option) && !isPleaseSelect(option)) return option;
      }
      const indexed = select.selectedIndex >= 0 ? select.options.item(select.selectedIndex) : null;
      if (indexed && !isPleaseSelect(indexed)) return indexed;
      return null;
    }

    function parseShippingPrice(label: string): number {
      const dollarMatches = [...label.matchAll(/\$\s*([\d,]+(?:\.\d{2})?)/g)];
      const priceToken =
        dollarMatches.length > 0
          ? dollarMatches[dollarMatches.length - 1]?.[1]
          : label.match(/([\d,]+\.\d{2})\s*$/)?.[1];
      if (!priceToken) return 0;
      const n = parseFloat(priceToken.replace(/,/g, ""));
      return Number.isFinite(n) ? n : 0;
    }

    function toOption(option: HTMLOptionElement): CartShippingOption {
      const value = (option.value ?? "").trim();
      const label = shippingOptionLabel(option);
      const price = parseShippingPrice(label);
      return price > 0 ? { value, label, price } : { value, label };
    }

    const select = findShippingSpeedSelect();
    if (!select) return null;

    const options: CartShippingOption[] = [];
    Array.from(select.options).forEach((option) => {
      if (isPleaseSelect(option)) return;
      options.push(toOption(option));
    });
    if (!options.length) return null;

    let selectedShippingValue = "";
    let selectedShippingTotal = 0;
    let selectedShippingOption: CartShippingOption | null = null;
    const selectedDom = findSelectedOption(select);

    if (selectedDom) {
      const selectedValue = (selectedDom.value ?? "").trim();
      const selectedLabel = shippingOptionLabel(selectedDom);
      if (selectedValue && selectedValue !== "0") {
        let match =
          options.find((option) => option.value === selectedValue) ??
          options.find((option) => option.label === selectedLabel);
        if (!match) {
          match = toOption(selectedDom);
          options.push(match);
        }
        selectedShippingValue = match.value;
        selectedShippingTotal = match.price ?? 0;
        selectedShippingOption = { ...match, selected: true };
      }
    }

    if (!selectedShippingValue && options.length === 1) {
      const only = options[0];
      if (only) {
        selectedShippingValue = only.value;
        selectedShippingTotal = only.price ?? 0;
        selectedShippingOption = { ...only, selected: true };
      }
    }

    const shippingOptions = options.map((option) => ({
      ...option,
      selected: Boolean(selectedShippingValue && option.value === selectedShippingValue),
    }));
    if (!selectedShippingOption) {
      selectedShippingOption = shippingOptions.find((option) => option.selected) ?? null;
    }

    return {
      shippingOptions,
      selectedShippingValue,
      selectedShippingOption,
      shippingTotal: selectedShippingTotal,
    };
  })();

  let resolvedShippingTotal = shippingTotal;
  if (shippingSpeedExtras?.shippingTotal && shippingSpeedExtras.shippingTotal > 0) {
    const dropdownTotal = shippingSpeedExtras.shippingTotal;
    if (
      shippingTotal === 0 ||
      Math.abs(Math.round(shippingTotal * 100) - Math.round(dropdownTotal * 100)) <= 2
    ) {
      resolvedShippingTotal = dropdownTotal;
    }
  }

  return {
    cartId,
    cartItems,
    shippingTotal: resolvedShippingTotal,
    ...(shippingState ? { shippingState } : {}),
    ...(shippingZip ? { shippingZip } : {}),
    ...(shippingSpeedExtras?.shippingOptions?.length
      ? { shippingOptions: shippingSpeedExtras.shippingOptions }
      : {}),
    ...(shippingSpeedExtras?.selectedShippingValue
      ? { selectedShippingValue: shippingSpeedExtras.selectedShippingValue }
      : {}),
    ...(shippingSpeedExtras?.selectedShippingOption
      ? { selectedShippingOption: shippingSpeedExtras.selectedShippingOption }
      : {}),
    taxTotal,
    ...(taxDescription ? { taxDescription } : {}),
    grandTotal,
  };
}

/**
 * Parses Volusion ShoppingCart.php/.asp in the current browser tab (same origin as cart).
 */
export function normalizeCartPayloadImages(payload: CartPayload): CartPayload {
  const normalized: CartPayload = {
    ...payload,
    cartItems: payload.cartItems.map((row) => {
      const imageUrl = normalizeProductImageUrl(row.imageUrl ?? null);
      return {
        ...row,
        ...(imageUrl ? { imageUrl } : {}),
      };
    }),
  };

  if (payload.shippingLabel !== undefined) {
    normalized.shippingLabel = payload.shippingLabel;
  }
  if (payload.shippingOptions !== undefined) {
    normalized.shippingOptions = payload.shippingOptions;
  }
  if (payload.selectedShippingValue !== undefined) {
    normalized.selectedShippingValue = payload.selectedShippingValue;
  }
  if (payload.selectedShippingOption !== undefined) {
    normalized.selectedShippingOption = payload.selectedShippingOption;
  }

  if (normalized.shippingOptions?.length && normalized.shippingTotal > 0) {
    const reconciled = reconcileShippingSelectionWithTotal(
      normalized.shippingOptions,
      normalized.shippingTotal,
      normalized.selectedShippingValue ?? normalized.selectedShippingOption?.value,
    );
    normalized.shippingOptions = reconciled.shippingOptions ?? normalized.shippingOptions;
    if (reconciled.selectedShippingValue) {
      normalized.selectedShippingValue = reconciled.selectedShippingValue;
      normalized.selectedShippingOption = reconciled.selectedShippingOption;
    }
  }

  return normalized;
}

export async function extractCartFromPage(): Promise<CartPayload> {
  if (typeof window === "undefined") {
    return {
      cartId: DEFAULT_CART_ID,
      cartItems: [],
      shippingTotal: 0,
      taxTotal: 0,
      grandTotal: 0,
    };
  }
  return normalizeCartPayloadImages(await extractCartPayloadInBrowser());
}

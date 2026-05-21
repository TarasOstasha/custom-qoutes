import { normalizeProductImageUrl } from "./normalizeProductImageUrl";

const DEFAULT_CART_ID = "07387C5E1E344F7DB151AE80E9894EE7";

export type CartItemRow = {
  productCode: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl?: string;
  options?: string[];
};

export type CartPayload = {
  cartId: string;
  cartItems: CartItemRow[];
  shippingTotal: number;
  shippingState?: string;
  shippingZip?: string;
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

  function popupDetailsPathFromAnchor(anchor: HTMLAnchorElement | null): string {
    if (!anchor) return "";
    const hrefRaw = anchor.getAttribute("href") ?? "";
    const onclickRaw = anchor.getAttribute("onclick") ?? "";
    const raw = [hrefRaw, onclickRaw].find((x) => /Help_CartItemDetails\.asp/i.test(x)) ?? "";
    if (!raw) return "";
    const openWindowMatch = raw.match(/OpenNewWindow\(\s*['"]([^'"]+)['"]/i);
    const directPathMatch = raw.match(/(Help_CartItemDetails\.asp\?[^'"\s)]+)/i);
    const path = openWindowMatch?.[1] ?? directPathMatch?.[1] ?? "";
    return path.trim();
  }

  function isLikelyProductRow(tr: HTMLTableRowElement): boolean {
    if (tr.querySelector('a[href*="ProductCode"], a[href*="productcode"]')) return true;
    if (tr.querySelector('input[id^="Quantity"], input[name^="Quantity"]')) return true;
    if (tr.querySelector(".cart-item-name")) return true;
    return false;
  }

  function findOptionsAnchorNearRow(rows: HTMLTableRowElement[], rowIndex: number): HTMLAnchorElement | null {
    const current = rows[rowIndex];
    if (!current) return null;

    const inCurrent = current.querySelector(
      'a[href*="Help_CartItemDetails.asp"], a[href*="OpenNewWindow"], a[onclick*="Help_CartItemDetails.asp"], a[title*="View list of options"]'
    ) as HTMLAnchorElement | null;
    if (inCurrent) return inCurrent;

    for (let i = rowIndex + 1; i < Math.min(rows.length, rowIndex + 5); i += 1) {
      const next = rows[i];
      if (!next) break;
      if (isLikelyProductRow(next)) break;
      const candidate = next.querySelector(
        'a[href*="Help_CartItemDetails.asp"], a[href*="OpenNewWindow"], a[onclick*="Help_CartItemDetails.asp"], a[title*="View list of options"]'
      ) as HTMLAnchorElement | null;
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

      const extractFromOptionsSection = (rawText: string): string[] => {
        const lines = rawText
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const startIndex = lines.findIndex((line) => /^options\s*:?/i.test(line));
        if (startIndex < 0) return [];

        const sectionLines: string[] = [];
        for (let i = startIndex; i < lines.length; i += 1) {
          const line = lines[i] ?? "";
          if (i > startIndex && /^item\s*(name|price)\s*:?/i.test(line)) break;
          sectionLines.push(line);
        }

        const parsed: string[] = [];
        for (const rawLine of sectionLines) {
          const line = rawLine.replace(/^options\s*:\s*/i, "").trim();
          if (!line) continue;
          const pairMatch = line.match(/^([^:]{1,80})\s*:\s*(.+)$/);
          if (pairMatch) {
            const label = normalizeText(pairMatch[1] ?? "");
            const value = normalizeText(pairMatch[2] ?? "");
            if (label && value) {
              parsed.push(`${label}: ${value}`);
              continue;
            }
          }
          if (parsed.length > 0) {
            const last = parsed[parsed.length - 1] ?? "";
            parsed[parsed.length - 1] = `${last} ${line}`.trim();
          } else {
            parsed.push(line);
          }
        }
        return parsed;
      };

      const optionsFromSection = extractFromOptionsSection(rawBodyText);
      optionsFromSection.forEach((opt) => {
        if (!opt || seen.has(opt)) return;
        seen.add(opt);
        options.push(opt);
      });
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
    const optionsByPath = new Map<string, string[]>();

    for (let rowIndex = 0; rowIndex < rowList.length; rowIndex += 1) {
      const tr = rowList[rowIndex];
      if (!tr) continue;
      if (tr.closest("thead")) continue;

      const nameEl =
        tr.querySelector(".cart-item-name") ??
        tr.querySelector('td a[href*="Product"]') ??
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

      const imageUrl = pickProductImageSrc(tr);
      const abs = imageUrl ? toAbsoluteUrl(imageUrl) : undefined;

      const optionsAnchor = findOptionsAnchorNearRow(rowList, rowIndex);
      const popupPath = popupDetailsPathFromAnchor(optionsAnchor);
      let options: string[] = [];
      if (popupPath) {
        if (optionsByPath.has(popupPath)) {
          options = optionsByPath.get(popupPath) ?? [];
        } else {
          options = await scrapeOptionsFromPopupPath(popupPath);
          optionsByPath.set(popupPath, options);
        }
      }

      cartItems.push({
        productCode: productCode || name,
        name: name || productCode,
        qty,
        unitPrice,
        lineTotal,
        ...(abs ? { imageUrl: abs } : {}),
        ...(options.length ? { options } : {}),
      });
    }
  }

  if (!cartItems.length) {
    const seen = new Set<HTMLTableRowElement>();
    document.querySelectorAll('input[id^="Quantity"], input[name^="Quantity"]').forEach((inp) => {
      const tr = inp.closest("tr");
      if (!tr || tr.closest("thead") || seen.has(tr as HTMLTableRowElement)) return;
      seen.add(tr as HTMLTableRowElement);
      const nameEl =
        tr.querySelector(".cart-item-name") ??
        tr.querySelector('td a[href*="Product"]') ??
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
      cartItems.push({
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
  let shippingFromSelectedOption = false;

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

  // Preferred shipping source: selected shipping method option text (e.g. "UPS Ground $97.23").
  const shippingSelect = document.querySelector(
    'select[name="ShippingSpeedChoice"], select#ShippingSpeedChoice'
  ) as HTMLSelectElement | null;
  if (shippingSelect) {
    const selectedByIndex =
      shippingSelect.selectedIndex >= 0 ? shippingSelect.options.item(shippingSelect.selectedIndex) : null;
    const selectedByAttr = shippingSelect.querySelector("option[selected]") as HTMLOptionElement | null;
    const selected = selectedByIndex ?? selectedByAttr;
    const selectedText = (selected?.textContent ?? "").trim();
    const looksPlaceholder =
      /^please\s*select/i.test(selectedText) ||
      /^select\s+/i.test(selectedText);
    const hasPriceInText = /\$\s*[\d,]+(?:\.\d{1,2})?/.test(selectedText);
    if (!looksPlaceholder && hasPriceInText) {
      const v = parseMoney(selectedText);
      if (v > 0) {
        shippingTotal = v;
        shippingFromSelectedOption = true;
      }
    }
  }

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
        if (shippingFromSelectedOption && shippingTotal > 0) {
          // Trust explicitly selected shipping method; derive tax remainder.
          taxTotal = round2(Math.max(0, feesExpected - shippingTotal));
        } else if (taxTotal > 0 && shippingTotal === 0) {
          shippingTotal = round2(Math.max(0, feesExpected - taxTotal));
        } else if (shippingTotal > 0 && taxTotal === 0) {
          taxTotal = round2(Math.max(0, feesExpected - shippingTotal));
        } else {
          // Last resort: preserve parsed tax and backfill shipping.
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

  return {
    cartId,
    cartItems,
    shippingTotal,
    ...(shippingState ? { shippingState } : {}),
    ...(shippingZip ? { shippingZip } : {}),
    taxTotal,
    ...(taxDescription ? { taxDescription } : {}), 
    grandTotal,
  };
}

/**
 * Parses Volusion ShoppingCart.asp in the current browser tab (same origin as cart).
 */
export function normalizeCartPayloadImages(payload: CartPayload): CartPayload {
  return {
    ...payload,
    cartItems: payload.cartItems.map((row) => {
      const imageUrl = normalizeProductImageUrl(row.imageUrl ?? null);
      return {
        ...row,
        ...(imageUrl ? { imageUrl } : {}),
      };
    }),
  };
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

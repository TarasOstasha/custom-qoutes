require("../lib/playwrightSetup");

import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  filterCartSummariesByEmail,
  isAbandonedCartGuid,
  looksLikeCartId,
  mapCartContentsRow,
  mapCartIdLogListRow,
  parseAbandonedCartContentsHtml,
  type AbandonedCartLine,
  type AbandonedCartSummary,
} from "../lib/abandonedCart";

const CART_ID_LOG_URL =
  process.env.VOLUSION_CART_ID_LOG_URL?.trim() ||
  "https://www.xyzdisplays.com/admin/TableViewer.asp?table=CartIDLog";

let adminBrowser: Browser | null = null;
let adminContext: BrowserContext | null = null;
let adminPage: Page | null = null;

function preferPhpAdminUrl(url: string): string {
  return url.replace(/\.asp(?=($|\?|#))/gi, ".php");
}

function urlVariants(url: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    if (!out.includes(value)) out.push(value);
  };
  push(url);
  if (/\.asp(?=($|\?|#))/i.test(url)) push(preferPhpAdminUrl(url));
  if (/\.php(?=($|\?|#))/i.test(url)) push(url.replace(/\.php(?=($|\?|#))/gi, ".asp"));
  return out;
}

async function isLoginPage(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("login.volusion.com") || url.includes("/login")) return true;
  return page
    .locator('input[type="password"]')
    .first()
    .isVisible()
    .catch(() => false);
}

async function fillFirstVisible(page: Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.fill(value);
      return true;
    }
  }
  return false;
}

async function loginIfNeeded(page: Page): Promise<void> {
  const loginEmail = process.env.VOLUSION_LOGIN_EMAIL;
  const password = process.env.VOLUSION_LOGIN_PASSWORD;
  if (!loginEmail || !password) {
    throw new Error("Missing VOLUSION_LOGIN_EMAIL or VOLUSION_LOGIN_PASSWORD.");
  }

  // Volusion Admin Auth0: username + password on one form, submit button[name=action].
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await isLoginPage(page))) return;

    const filledUser = await fillFirstVisible(
      page,
      [
        "input#username",
        'input[name="username"]',
        'input[name="email"]',
        'input[name="Email"]',
        'input[name="Login"]',
        'input[type="email"]',
      ],
      loginEmail,
    );
    const filledPass = await fillFirstVisible(
      page,
      ["input#password", 'input[name="password"]', 'input[name="Password"]', 'input[type="password"]'],
      password,
    );

    const submitSelectors = [
      'button[name="action"]',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Continue")',
      'button:has-text("Sign In")',
      'button:has-text("Login")',
    ];
    let submitted = false;
    for (const selector of submitSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        submitted = true;
        break;
      }
    }
    if (!submitted) {
      await page.keyboard.press("Enter");
    }
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await delay(filledUser || filledPass ? 1500 : 700);

    // Wait for Auth0 redirect back to store admin when possible.
    await page
      .waitForURL((url) => !url.toString().toLowerCase().includes("login.volusion.com"), {
        timeout: 20_000,
      })
      .catch(() => undefined);
  }

  if (await isLoginPage(page)) {
    throw new Error("Volusion admin login failed (still on login page).");
  }
}

async function ensureOnCartIdLog(page: Page): Promise<void> {
  for (const url of urlVariants(CART_ID_LOG_URL)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await loginIfNeeded(page);
    if (await isLoginPage(page)) continue;
    // Re-goto after login in case Auth0 left us on a generic admin home.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await loginIfNeeded(page);
    const html = await page.content();
    if (/CartIDLog|Abandoned\s*\/\s*Live\s*Carts?|TableViewer/i.test(html) || /CartID/i.test(html)) {
      return;
    }
  }
}

async function getAdminPage(): Promise<Page> {
  if (adminPage && !adminPage.isClosed() && adminContext) {
    return adminPage;
  }

  if (adminBrowser) {
    try {
      await adminBrowser.close();
    } catch {
      /* ignore */
    }
  }

  adminBrowser = await chromium.launch({ headless: true });
  adminContext = await adminBrowser.newContext({
    userAgent:
      process.env.VOLUSION_STORE_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  adminPage = await adminContext.newPage();
  await ensureOnCartIdLog(adminPage);
  return adminPage;
}

export async function closeVolusionCartIdLogSession(): Promise<void> {
  if (adminBrowser) {
    try {
      await adminBrowser.close();
    } catch {
      /* ignore */
    }
  }
  adminBrowser = null;
  adminContext = null;
  adminPage = null;
}

async function scrapeCartIdLogRowsFromPage(page: Page): Promise<AbandonedCartSummary[]> {
  const rawRows = await page.evaluate(() => {
    const out: string[][] = [];
    for (const tr of Array.from(document.querySelectorAll("tr"))) {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) =>
        (td.textContent ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(),
      );
      if (cells.some((c) => c)) out.push(cells);
    }
    return out;
  });

  const carts: AbandonedCartSummary[] = [];
  const seen = new Set<string>();
  for (const cells of rawRows) {
    const summary = mapCartIdLogListRow(cells);
    if (!summary) continue;
    const key = summary.cartId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    carts.push(summary);
  }
  return carts;
}

async function tryAdminSearch(page: Page, query: string): Promise<void> {
  const searchLink = page.locator('a:has-text("Search")').first();
  if (await searchLink.isVisible().catch(() => false)) {
    await searchLink.click().catch(() => undefined);
    await delay(400);
  }

  const searchInputs = [
    'input[name="Search"]',
    'input[name="search"]',
    'input[name="Keyword"]',
    'input[name="keyword"]',
    'input[name="searchfor"]',
    'input[name="SearchFor"]',
    'input[type="search"]',
    'input[name="Email"]',
    'input[name="email"]',
  ];
  let filled = false;
  for (const selector of searchInputs) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.fill(query);
      filled = true;
      break;
    }
  }
  if (!filled) return;

  const submit = page
    .locator('input[type="submit"], button[type="submit"], button:has-text("Search"), input[value*="Search" i]')
    .first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    await page.keyboard.press("Enter");
  }
  await page.waitForLoadState("domcontentloaded");
  await delay(500);
}

export async function searchAbandonedCartsByEmail(
  email: string,
): Promise<AbandonedCartSummary[]> {
  const needle = email.trim();
  if (!needle) throw new Error("Email is required");

  const page = await getAdminPage();
  await ensureOnCartIdLog(page);
  await tryAdminSearch(page, needle);

  let carts = filterCartSummariesByEmail(await scrapeCartIdLogRowsFromPage(page), needle);

  // If search UI didn't narrow results, fall back to scanning a few list pages.
  if (!carts.length) {
    await ensureOnCartIdLog(page);
    const collected: AbandonedCartSummary[] = [];
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      collected.push(...(await scrapeCartIdLogRowsFromPage(page)));
      const next = page.locator('a:has-text("Next"), a[title*="Next" i], a:has-text(">")').first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click().catch(() => undefined);
      await page.waitForLoadState("domcontentloaded");
      await delay(400);
    }
    carts = filterCartSummariesByEmail(collected, needle);
  }

  return carts;
}

function pageLooksLikeAbandonedCartDetail(html: string): boolean {
  return (
    /Shopping\s+Cart\s+Contents/i.test(html) &&
    (/Abandoned\s*\/\s*Live\s*Cart/i.test(html) || /ProductCode/i.test(html))
  );
}

async function pageHasCartContents(page: Page): Promise<boolean> {
  const url = page.url().toLowerCase();
  if (url.includes("norecord=y") || /[?&]id=(?:&|$)/i.test(url)) {
    return false;
  }
  const html = await page.content();
  if (/NoRecord=Y|No\s+Record/i.test(html) && !/ProductCode/i.test(html)) {
    return false;
  }
  if (pageLooksLikeAbandonedCartDetail(html)) {
    return linesFromContentRows(await extractContentsRowsFromDom(page)).length > 0
      || /#ShoppingCartContents[\s\S]*?ProductCode/i.test(html)
      || /id=["']ShoppingCartContents["'][\s\S]*?ProductCode/i.test(html);
  }
  if (/Shopping\s+Cart\s+Contents/i.test(html) && /ProductCode/i.test(html)) {
    return true;
  }
  return linesFromContentRows(await extractContentsRowsFromDom(page)).length > 0;
}

async function extractContentsRowsFromDom(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const normalize = (value: string) =>
      value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

    const isHeader = (row: string[]) => {
      const keys = row.map((c) => c.toLowerCase().replace(/[\s_]+/g, ""));
      return keys.includes("productcode") && (keys.includes("optionids") || keys.includes("qty"));
    };

    // Prefer the dedicated Volusion contents table (avoids nested/flattened admin chrome rows).
    const scoped =
      document.querySelectorAll("#ShoppingCartContents tr").length > 0
        ? Array.from(document.querySelectorAll("#ShoppingCartContents tr"))
        : Array.from(document.querySelectorAll("tr"));

    const allRows: string[][] = [];
    for (const tr of scoped) {
      const cells = Array.from(tr.querySelectorAll("td,th")).map((td) =>
        normalize(td.textContent ?? ""),
      );
      if (cells.some((c) => c)) allRows.push(cells);
    }

    const headerIdx = allRows.findIndex((row) => isHeader(row));
    if (headerIdx < 0) return allRows;

    const headers = allRows[headerIdx] ?? [];
    const out: string[][] = [headers];
    for (let i = headerIdx + 1; i < allRows.length; i += 1) {
      const row = allRows[i] ?? [];
      if (row.some((cell) => /^cart\s*info$/i.test(cell) || (/^id$/i.test(cell) && row.length <= 2))) {
        break;
      }
      const first = (row[0] ?? "").trim();
      if (!first) continue;
      if (/^productcode$/i.test(first)) continue;
      if (/^shopping\s+cart\s+contents/i.test(first)) continue;
      out.push(row);
    }
    return out;
  });
}

function linesFromContentRows(rows: string[][]): AbandonedCartLine[] {
  if (rows.length < 2) return [];
  const headers = rows[0] ?? [];
  const lines: AbandonedCartLine[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const line = mapCartContentsRow(headers, rows[i] ?? []);
    if (line) lines.push(line);
  }
  return lines;
}

async function findCartDetailHrefOnPage(page: Page, cartId: string): Promise<string | null> {
  const id = cartId.trim().toLowerCase();
  return page.evaluate((needle) => {
    for (const a of Array.from(document.querySelectorAll("a"))) {
      const text = (a.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      const hrefAttr = (a.getAttribute("href") ?? "").toLowerCase();
      const href = ((a as HTMLAnchorElement).href || "").toLowerCase();
      if (text === needle || hrefAttr.includes(needle) || href.includes(needle)) {
        try {
          return new URL((a as HTMLAnchorElement).href, window.location.href).href;
        } catch {
          return (a as HTMLAnchorElement).href || null;
        }
      }
    }
    return null;
  }, id);
}

async function clickCartDetailOnPage(page: Page, cartId: string): Promise<boolean> {
  const id = cartId.trim();
  const candidates = [
    page.locator(`a[href*="${id}" i]`).first(),
    page.getByRole("link", { name: id, exact: true }).first(),
    page.locator(`a:has-text("${id}")`).first(),
    page.locator(`td:has-text("${id}") a`).first(),
    page.locator(`tr:has-text("${id}") a`).first(),
  ];

  for (const link of candidates) {
    if (!(await link.isVisible().catch(() => false))) continue;
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      link.click({ timeout: 8_000 }),
    ]).catch(() => undefined);
    await delay(800);
    await loginIfNeeded(page);
    if (await pageHasCartContents(page)) return true;
  }
  return false;
}

async function openCartDetailById(page: Page, cartId: string): Promise<void> {
  const id = cartId.trim();

  const tryNavigate = async (url: string): Promise<boolean> => {
    for (const variant of urlVariants(url)) {
      console.log("[abandoned-cart] try detail url", variant);
      await page.goto(variant, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await loginIfNeeded(page);
      await delay(500);
      if (await pageHasCartContents(page)) {
        console.log("[abandoned-cart] detail opened via", variant, "→", page.url());
        return true;
      }
    }
    return false;
  };

  // Direct detail URL used by this store's Abandoned / Live Cart page.
  const directCandidates = [
    `https://www.xyzdisplays.com/admin/AdminDetails_Generic.php?Table=CartIDLog&ID=${encodeURIComponent(id)}`,
    `https://www.xyzdisplays.com/admin/AdminDetails_Generic.asp?Table=CartIDLog&ID=${encodeURIComponent(id)}`,
    `https://www.xyzdisplays.com/admin/AdminDetails_Generic.php?Table=CartIDLog&id=${encodeURIComponent(id)}`,
    `https://www.xyzdisplays.com/admin/AdminDetails.asp?Table=CartIDLog&ID=${encodeURIComponent(id)}`,
    `https://www.xyzdisplays.com/admin/AdminDetails.php?Table=CartIDLog&ID=${encodeURIComponent(id)}`,
  ];
  for (const url of directCandidates) {
    if (await tryNavigate(url)) return;
  }

  // Fallback: CartIDLog list → search → click GUID link.
  await ensureOnCartIdLog(page);
  await tryAdminSearch(page, id);

  for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
    if (await clickCartDetailOnPage(page, id)) return;

    const href = await findCartDetailHrefOnPage(page, id);
    if (href) {
      if (await tryNavigate(href)) return;
      if (await clickCartDetailOnPage(page, id)) return;
    }

    if (await pageHasCartContents(page)) return;

    const next = page.locator('a:has-text("Next"), a[title*="Next" i]').first();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click().catch(() => undefined);
    await page.waitForLoadState("domcontentloaded");
    await delay(300);
  }

  throw new Error(
    `Could not open Abandoned/Live Cart detail for cart ${id} (last url: ${page.url()})`,
  );
}

export async function fetchAbandonedCartContents(
  cartId: string,
): Promise<{ cartId: string; items: AbandonedCartLine[] }> {
  const id = cartId.trim();
  if (!id || !looksLikeCartId(id)) {
    throw new Error("A valid cart GUID is required");
  }

  const page = await getAdminPage();
  await openCartDetailById(page, id);

  await page
    .getByText(/Shopping\s+Cart\s+Contents/i)
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => undefined);
  await delay(300);

  const html = await page.content();
  let items = parseAbandonedCartContentsHtml(html);
  if (!items.length) {
    items = linesFromContentRows(await extractContentsRowsFromDom(page));
  }

  console.log("[abandoned-cart] contents", {
    cartId: id,
    url: page.url(),
    itemCount: items.length,
    products: items.map((item) => item.productCode),
    optionIds: items.map((item) => item.optionIds),
  });

  return { cartId: id, items };
}

/**
 * Resolve the newest Abandoned/Live cart GUID for a customer email.
 * Does not guess by product codes (too easy to pick the wrong cart).
 */
export async function resolveAbandonedCartGuidByEmail(
  email: string,
): Promise<string | null> {
  const carts = await searchAbandonedCartsByEmail(email);
  if (!carts.length) return null;
  const hit = carts.find((cart) => isAbandonedCartGuid(cart.cartId));
  if (hit) {
    console.log("[abandoned-cart] resolved GUID by email", {
      email,
      cartId: hit.cartId,
      itemCount: hit.itemCount,
      lastModified: hit.lastModified,
    });
    return hit.cartId;
  }
  return null;
}

/** Resolve email for a cart GUID (used by legacy identify-user). */
export async function findEmailForCartId(cartId: string): Promise<string | null> {
  const id = cartId.trim();
  if (!id) return null;
  const page = await getAdminPage();
  await ensureOnCartIdLog(page);
  await tryAdminSearch(page, id);

  const carts = await scrapeCartIdLogRowsFromPage(page);
  const match = carts.find((c) => c.cartId.toLowerCase() === id.toLowerCase());
  if (match?.email) return match.email;

  await ensureOnCartIdLog(page);
  for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
    const pageCarts = await scrapeCartIdLogRowsFromPage(page);
    const hit = pageCarts.find((c) => c.cartId.toLowerCase() === id.toLowerCase());
    if (hit) return hit.email;
    const next = page.locator('a:has-text("Next"), a[title*="Next" i]').first();
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click().catch(() => undefined);
    await page.waitForLoadState("domcontentloaded");
    await delay(300);
  }
  return null;
}

require("../lib/playwrightSetup");

import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  extractCartPayloadInBrowser,
  normalizeCartPayloadImages,
  type CartItemRow,
  type CartPayload,
} from "../lib/extractCartFromPage";
import {
  enrichPayloadWithShippingSpeedChoice,
  SHIPPING_SPEED_SELECT_SELECTOR,
} from "../lib/extractShippingSpeedChoiceInBrowser";
import {
  extractAbandonedCartGuidFromText,
  isAbandonedCartGuid,
} from "../lib/abandonedCart";
import {
  configuredStorefrontEmail,
  ensureVolusionStorefrontLogin,
} from "./volusionStorefrontLogin";
import { resolveAbandonedCartGuidByEmail } from "./volusionCartIdLog";

const DEFAULT_CART_URL = "https://www.xyzdisplays.com/ShoppingCart.php";
const STORE_HOME_URL = "https://www.xyzdisplays.com/";

export type ScrapeStorefrontCartOptions = {
  cartUrl?: string;
};

let liveContext: BrowserContext | null = null;
let livePage: Page | null = null;

function envHeadless(defaultValue = true): boolean {
  const raw = process.env.VOLUSION_PLAYWRIGHT_HEADLESS?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return defaultValue;
}

function preferPhpStorefrontUrl(url: string): string {
  return url.replace(/\.asp(?=($|\?|#))/gi, ".php");
}

function resolveCartUrl(options: ScrapeStorefrontCartOptions = {}): string {
  const raw =
    options.cartUrl?.trim() ||
    process.env.VOLUSION_STORE_CART_URL?.trim() ||
    DEFAULT_CART_URL;
  return preferPhpStorefrontUrl(raw);
}

async function launchVisiblePersistentContext(): Promise<BrowserContext> {
  const profileDir = process.env.VOLUSION_PLAYWRIGHT_USER_DATA_DIR?.trim() || ".playwright-volusion-profile";
  const userDataDir = resolve(profileDir);
  await mkdir(userDataDir, { recursive: true });

  if (liveContext) {
    try {
      await liveContext.close();
    } catch {
      /* context may already be closed */
    }
    liveContext = null;
    livePage = null;
  }

  liveContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ["--window-size=1440,900"],
    viewport: null,
    userAgent:
      process.env.VOLUSION_STORE_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  return liveContext;
}

async function getOrCreateLiveSession(options: ScrapeStorefrontCartOptions = {}): Promise<Page> {
  const profileDir = process.env.VOLUSION_PLAYWRIGHT_USER_DATA_DIR?.trim() || ".playwright-volusion-profile";

  const userDataDir = resolve(profileDir);
  await mkdir(userDataDir, { recursive: true });

  const cartUrl = resolveCartUrl(options);

  // Default to headless; set 0/false/no/off to open visible browser.
  const headless = envHeadless(true);

  if (!liveContext) {
    liveContext = await chromium.launchPersistentContext(userDataDir, {
      headless,
      args: ["--window-size=1440,900"],
      viewport: null,
      userAgent:
        process.env.VOLUSION_STORE_USER_AGENT?.trim() ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
  }

  if (!livePage || livePage.isClosed()) {
    const existing = liveContext.pages().find((p) => !p.isClosed());
    livePage = existing ?? (await liveContext.newPage());
    await livePage.goto(cartUrl, { waitUntil: "load", timeout: 90_000 });
    await delay(500);
    await ensureVolusionStorefrontLogin(livePage);
  }

  return livePage;
}

export async function openVolusionStorefrontCartSession(
  options: ScrapeStorefrontCartOptions = {}
): Promise<{ opened: true; url: string }> {
  const page = await getOrCreateLiveSession(options);
  await page.goto(resolveCartUrl(options), { waitUntil: "load", timeout: 90_000 });
  await delay(500);
  return { opened: true, url: page.url() };
}

/** Shared live Playwright cart page for rebuild / scrape flows. */
export async function getVolusionStorefrontLivePage(
  options: ScrapeStorefrontCartOptions = {},
): Promise<Page> {
  return getOrCreateLiveSession(options);
}

/**
 * Open a manual, visible Playwright session on storefront homepage.
 * Keeps the browser/context alive for user interaction.
 */
export async function openVisibleVolusionHomepageSession(): Promise<{
  opened: true;
  url: string;
  storefrontLogin?: { loggedIn: boolean; email: string | null; error?: string };
}> {
  const context = await launchVisiblePersistentContext();
  livePage = await context.newPage();
  await livePage.goto(STORE_HOME_URL, { waitUntil: "load", timeout: 90_000 });
  const storefrontLogin = await ensureVolusionStorefrontLogin(livePage);
  await livePage.goto(STORE_HOME_URL, { waitUntil: "load", timeout: 90_000 }).catch(() => undefined);
  return { opened: true, url: livePage.url(), storefrontLogin };
}

/**
 * Re-open or focus the live session cart page in a visible browser window.
 * Used when the user closed Chromium but the quote builder session is still ready.
 */
export async function openVisibleVolusionCartSession(
  options: ScrapeStorefrontCartOptions = {},
): Promise<{ opened: true; url: string }> {
  const cartUrl = resolveCartUrl(options);

  const navigateCart = async (page: Page) => {
    await ensureVolusionStorefrontLogin(page);
    await page.goto(cartUrl, { waitUntil: "load", timeout: 90_000 });
    await delay(500);
    return { opened: true as const, url: page.url() };
  };

  if (liveContext) {
    try {
      if (livePage && !livePage.isClosed()) {
        return await navigateCart(livePage);
      }
      const existing = liveContext.pages().find((p) => !p.isClosed());
      livePage = existing ?? (await liveContext.newPage());
      return await navigateCart(livePage);
    } catch {
      liveContext = null;
      livePage = null;
    }
  }

  const context = await launchVisiblePersistentContext();
  livePage = await context.newPage();
  return await navigateCart(livePage);
}

function formatChosenOptionText(text: string): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const pair = normalized.match(/^([^:]{1,80})\s*:\s*(.+)$/);
  if (!pair) return normalized;
  const label = String(pair[1] ?? "").replace(/\s+/g, " ").trim();
  const value = String(pair[2] ?? "").replace(/\s+/g, " ").trim();
  if (!label || !value) return normalized;
  return `${label}: ${value}`;
}

function cartLineKeyFromPopupPath(popupPath: string | undefined, pageUrl: string): string {
  const path = (popupPath ?? "").trim();
  if (!path) return "";
  try {
    return new URL(path, pageUrl).searchParams.get("CartID")?.trim() ?? "";
  } catch {
    const match = path.match(/[?&]CartID=([^&]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }
}

/**
 * Primary options source after Volusion PHP theme change:
 * click `a[href="javascript:void(0);"]` inside cart details,
 * then read `#vol-pop-up-to-modal .vol-chosen-options-list li`.
 */
async function enrichCartItemOptionsFromModal(page: Page, payload: CartPayload): Promise<void> {
  const rows: CartItemRow[] = payload.cartItems ?? [];
  if (!rows.length) return;

  const optionsByCartId = new Map<string, string[]>();
  const optionsByProductCode = new Map<string, string[]>();
  const optionsInOrder: string[][] = [];

  // Prefer the exact cart detail cells, but fall back to any void(0) options link in the cart table.
  const optionLinks = page
    .locator("#v65-cart-table a[href='javascript:void(0);'], #v65-cart-table a[href=\"javascript:void(0);\"]")
    .filter({ hasText: /view list of options/i });
  let linkCount = await optionLinks.count();
  if (!linkCount) {
    const cellLinks = page.locator(".v65-cart-details-text a[href='javascript:void(0);']").filter({
      hasText: /view list of options/i,
    });
    linkCount = await cellLinks.count();
  }

  const links = page.locator("a[href='javascript:void(0);']").filter({
    hasText: /view list of options/i,
  });
  const totalLinks = await links.count();
  console.error(`[scrape-cart] options void(0) links found: ${totalLinks}`);

  for (let i = 0; i < totalLinks; i += 1) {
    const link = links.nth(i);

    const meta = await link.evaluate((el) => {
      const cell = el.closest("td") ?? el.parentElement;
      const productLink = cell?.querySelector(
        'a[href*="ProductCode"], a[href*="productcode"], a[href*="ProductDetails"]',
      ) as HTMLAnchorElement | null;
      const href = (productLink?.getAttribute("href") ?? "").replace(/&amp;/g, "&");
      let cartId = "";
      let productCode = "";
      try {
        const url = new URL(href, window.location.href);
        cartId = url.searchParams.get("CartID")?.trim() ?? "";
        productCode = (
          url.searchParams.get("ProductCode") ??
          url.searchParams.get("productcode") ??
          ""
        ).trim();
      } catch {
        const cartIdMatch = href.match(/[?&]CartID=([^&]+)/i);
        const productMatch = href.match(/[?&]ProductCode=([^&]+)/i);
        cartId = cartIdMatch?.[1] ? decodeURIComponent(cartIdMatch[1]) : "";
        productCode = productMatch?.[1] ? decodeURIComponent(productMatch[1]) : "";
      }
      return { cartId, productCode, href, linkText: (el.textContent ?? "").replace(/\s+/g, " ").trim() };
    });

    await link.click({ timeout: 5_000 }).catch((err) => {
      console.error("[scrape-cart] options link click failed:", err);
    });

    const list = page.locator("#vol-pop-up-to-modal .modal-body.modal__body .vol-chosen-options-list li, #vol-pop-up-to-modal .vol-chosen-options-list li");
    try {
      await page.locator("#vol-pop-up-to-modal.modal, #vol-pop-up-to-modal").waitFor({
        state: "visible",
        timeout: 8_000,
      });
      await list.first().waitFor({ state: "attached", timeout: 8_000 });
    } catch (err) {
      console.error("[scrape-cart] modal wait failed:", meta, err);
    }
    await delay(400);

    const rawItems = await list.allTextContents().catch(() => [] as string[]);
    const options = rawItems.map(formatChosenOptionText).filter(Boolean);
    console.error(
      `[scrape-cart] modal options for ${meta.productCode || "unknown"} CartID=${meta.cartId}:`,
      options.length,
      options,
    );

    if (options.length) {
      optionsInOrder.push(options);
      if (meta.cartId) optionsByCartId.set(meta.cartId, options);
      if (meta.productCode) {
        const key = meta.productCode.toLowerCase();
        // Keep per-line options by CartID; product map is fallback only.
        if (!optionsByProductCode.has(key)) optionsByProductCode.set(key, options);
      }
    }

    const closeBtn = page.locator(
      "#vol-pop-up-to-modal button.close, #vol-pop-up-to-modal [data-dismiss='modal']",
    );
    if ((await closeBtn.count()) > 0) {
      await closeBtn.first().click({ timeout: 2_000 }).catch(() => undefined);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await page
      .locator("#vol-pop-up-to-modal")
      .waitFor({ state: "hidden", timeout: 3_000 })
      .catch(() => undefined);
    await delay(250);
  }

  let orderIndex = 0;
  for (const row of rows) {
    const cartId = cartLineKeyFromPopupPath(row.optionsPopupPath, page.url());
    const byCartId = cartId ? optionsByCartId.get(cartId) : undefined;
    if (byCartId?.length) {
      row.options = byCartId;
      orderIndex += 1;
      continue;
    }

    // Fallback: CartID embedded in cartLineId like volusion_1_p345500
    const lineIdMatch = (row.cartLineId ?? "").match(/^volusion_(\d+)/i);
    const byLineId = lineIdMatch?.[1] ? optionsByCartId.get(lineIdMatch[1]) : undefined;
    if (byLineId?.length) {
      row.options = byLineId;
      orderIndex += 1;
      continue;
    }

    const productKey = (row.productCode ?? "").trim().toLowerCase();
    const byProduct = productKey ? optionsByProductCode.get(productKey) : undefined;
    if (byProduct?.length) {
      row.options = byProduct;
      orderIndex += 1;
      continue;
    }

    const byOrder = optionsInOrder[orderIndex];
    if (byOrder?.length) row.options = byOrder;
    orderIndex += 1;
  }
}

/**
 * Prefer CartIDLog UUID from Playwright cookies / storage over line-level CartIDs.
 */
async function resolveAbandonedCartGuidFromLivePage(page: Page): Promise<string | null> {
  try {
    const cookies = await page.context().cookies();
    for (const cookie of cookies) {
      const fromValue = extractAbandonedCartGuidFromText(cookie.value);
      if (fromValue) return fromValue;
      const fromName = extractAbandonedCartGuidFromText(cookie.name);
      if (fromName) return fromName;
    }
  } catch {
    /* ignore */
  }

  try {
    const fromDom = await page.evaluate(() => {
      const guidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const pick = (raw: string): string | null => {
        try {
          const decoded = decodeURIComponent(raw);
          return decoded.match(guidRe)?.[0] ?? null;
        } catch {
          return raw.match(guidRe)?.[0] ?? null;
        }
      };
      for (const part of String(document.cookie ?? "").split(";")) {
        const value = part.split("=").slice(1).join("=").trim();
        const found = pick(value);
        if (found) return found;
      }
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        const found = pick(localStorage.getItem(key) ?? "") || pick(key);
        if (found) return found;
      }
      return null;
    });
    if (fromDom && isAbandonedCartGuid(fromDom)) return fromDom;
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * Scrape cart data from the live opened Playwright session.
 */
export async function scrapeVolusionStorefrontCart(
  options: ScrapeStorefrontCartOptions = {}
): Promise<CartPayload> {
  const cartUrl = resolveCartUrl(options);
  const page = await getOrCreateLiveSession(options);
  await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page
    .waitForSelector("#v65-cart-total-estimate-cell, #v65-cart-table", {
      state: "attached",
      timeout: 20_000,
    })
    .catch(() => {
      /* cart may still parse with fallbacks */
    });
  await delay(500);
  await page
    .waitForSelector(SHIPPING_SPEED_SELECT_SELECTOR, {
      state: "attached",
      timeout: 10_000,
    })
    .catch(() => {
      /* shipping widget may be absent until destination is set */
    });

  const debug = process.env.SCRAPE_CART_DEBUG === "1";
  if (debug) {
    console.error("[scrape-cart] url:", page.url());
    console.error("[scrape-cart] title:", await page.title());
    console.error("[scrape-cart] #v65-cart-table:", await page.locator("#v65-cart-table").count());
    console.error("[scrape-cart] body snippet:", (await page.content()).slice(0, 2000));
  }

  const raw = await page.evaluate(extractCartPayloadInBrowser);
  // Authoritative options source: click void(0) links → #vol-pop-up-to-modal .vol-chosen-options-list
  await enrichCartItemOptionsFromModal(page, raw);
  await enrichPayloadWithShippingSpeedChoice(page, raw);

  if (!isAbandonedCartGuid(raw.cartId)) {
    const fromSession = await resolveAbandonedCartGuidFromLivePage(page);
    if (fromSession) {
      raw.cartId = fromSession;
    } else {
      const email = configuredStorefrontEmail();
      if (email) {
        try {
          const fromEmail = await resolveAbandonedCartGuidByEmail(email);
          if (fromEmail) raw.cartId = fromEmail;
        } catch (error) {
          console.error("[scrape-cart] abandoned cart GUID email resolve failed:", error);
        }
      }
    }
  }

  if (debug) {
    console.error("[scrape-cart] shippingTotal:", raw.shippingTotal);
    console.error("[scrape-cart] selectedShippingValue:", raw.selectedShippingValue ?? null);
    console.error("[scrape-cart] shippingOptions:", raw.shippingOptions?.length ?? 0);
    console.error("[scrape-cart] cartId:", raw.cartId);
    console.error(
      "[scrape-cart] item options:",
      raw.cartItems.map((item) => ({
        productCode: item.productCode,
        options: item.options?.length ?? 0,
      })),
    );
  }

  return normalizeCartPayloadImages(raw);
}

export type ClearCartMethod = "clearcart-query" | "none";

export type ClearVolusionCartResult = {
  success: boolean;
  removedCount: number;
  cartEmpty: boolean;
  method: ClearCartMethod;
};

function resolveClearCartUrl(cartUrl: string): string {
  const url = new URL(cartUrl);
  url.search = "";
  url.searchParams.set("ClearCart", "Y");
  return url.href;
}

/** Clear the Volusion storefront cart via ShoppingCart.php?ClearCart=Y. */
export async function clearVolusionStorefrontCart(
  options: ScrapeStorefrontCartOptions = {}
): Promise<ClearVolusionCartResult> {
  const clearCartUrl = resolveClearCartUrl(resolveCartUrl(options));
  const page = await getOrCreateLiveSession(options);

  await page.goto(clearCartUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });

  console.log("[clear-cart] method: clearcart-query");

  return {
    success: true,
    removedCount: 0,
    cartEmpty: true,
    method: "clearcart-query",
  };
}

export async function closeVolusionStorefrontCartSession(): Promise<void> {
  if (liveContext) {
    await liveContext.close();
  }
  liveContext = null;
  livePage = null;
}

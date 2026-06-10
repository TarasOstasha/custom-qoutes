import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  extractCartPayloadInBrowser,
  normalizeCartPayloadImages,
  type CartPayload,
} from "../lib/extractCartFromPage";

const DEFAULT_CART_URL = "https://www.xyzdisplays.com/ShoppingCart.asp";
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

function resolveCartUrl(options: ScrapeStorefrontCartOptions = {}): string {
  return (
    options.cartUrl?.trim() ||
    process.env.VOLUSION_STORE_CART_URL?.trim() ||
    DEFAULT_CART_URL
  );
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
    args: ["--window-size=1000,900"],
    viewport: { width: 1000, height: 900 },
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
      //args: ["--start-maximized"],
      args: ["--window-size=1000,900",],
      viewport: { width: 1000, height: 900 },//viewport: null,//{ width: 1600, height: 1000 },
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

/**
 * Open a manual, visible Playwright session on storefront homepage.
 * Keeps the browser/context alive for user interaction.
 */
export async function openVisibleVolusionHomepageSession(): Promise<{ opened: true; url: string }> {
  const context = await launchVisiblePersistentContext();
  livePage = await context.newPage();
  await livePage.goto(STORE_HOME_URL, { waitUntil: "load", timeout: 90_000 });
  return { opened: true, url: livePage.url() };
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

  const debug = process.env.SCRAPE_CART_DEBUG === "1";
  if (debug) {
    console.error("[scrape-cart] url:", page.url());
    console.error("[scrape-cart] title:", await page.title());
    console.error("[scrape-cart] #v65-cart-table:", await page.locator("#v65-cart-table").count());
    console.error("[scrape-cart] body snippet:", (await page.content()).slice(0, 2000));
  }

  const raw = await page.evaluate(extractCartPayloadInBrowser);

  if (debug) {
    console.error("[scrape-cart] shippingTotal:", raw.shippingTotal);
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

/** Clear the Volusion storefront cart via ShoppingCart.asp?ClearCart=Y. */
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

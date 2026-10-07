require("../lib/playwrightSetup");

import { setTimeout as delay } from "node:timers/promises";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

const DEFAULT_CART_URL = "https://www.xyzdisplays.com/ShoppingCart.php";
const STORE_HOME_URL = "https://www.xyzdisplays.com/";

function isAuthOrLoginUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("login.volusion.com") ||
    u.includes("/admin/") ||
    u.includes("/login.php") ||
    u.includes("/login.asp") ||
    u.includes("myaccount.asp") ||
    u.includes("myaccount.php")
  );
}

/**
 * Close restored Login/admin tabs only. Keep at least one page — closing every
 * tab then calling newPage() can fail with Target.createTarget on Chromium.
 */
async function closeRestoredLoginPages(context: BrowserContext): Promise<void> {
  const pages = context.pages().filter((page) => !page.isClosed());
  if (!pages.length) return;

  const loginPages: Page[] = [];
  const keepPages: Page[] = [];
  for (const page of pages) {
    const url = page.url();
    if (isAuthOrLoginUrl(url) || url === "about:blank") {
      loginPages.push(page);
    } else {
      keepPages.push(page);
    }
  }

  // Prefer keeping a real storefront tab; otherwise keep one blank/login tab to reuse.
  const closable =
    keepPages.length > 0 ? loginPages : loginPages.slice(0, Math.max(0, loginPages.length - 1));
  for (const page of closable) {
    try {
      if (!page.isClosed()) await page.close();
    } catch {
      /* ignore */
    }
  }
}

async function getOrCreateContextPage(context: BrowserContext): Promise<Page> {
  const existing = context.pages().find((page) => !page.isClosed());
  if (existing) return existing;
  return context.newPage();
}

/** Clear leftover Volusion Auth / admin cookies so Open Session stays a guest storefront. */
async function clearVolusionAuthCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    const authCookies = cookies.filter((cookie) => {
      const domain = (cookie.domain || "").toLowerCase();
      const name = cookie.name.toLowerCase();
      const isLoginHost = domain.includes("login.volusion.com");
      const isAuthName =
        name.includes("auth") ||
        name.includes("a0") ||
        name.includes("oidc") ||
        name.includes("admin") ||
        name.includes("customer") ||
        name.includes("session");
      const isVolusionAuthHost = domain.includes("volusion.com") && isAuthName;
      return isLoginHost || isVolusionAuthHost;
    });
    for (const cookie of authCookies) {
      await context
        .clearCookies({
          name: cookie.name,
          domain: cookie.domain,
        })
        .catch(() => undefined);
    }
    if (authCookies.length) {
      console.log("[storefront] cleared Volusion auth/admin cookies:", authCookies.length);
    }
  } catch (error) {
    console.error("[storefront] clear auth cookies failed:", error);
  }
}

async function ensureGuestStorefrontPage(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "load", timeout: 90_000 });
  await delay(400);
  if (isAuthOrLoginUrl(page.url())) {
    await clearVolusionAuthCookies(page.context());
    await page.goto(targetUrl, { waitUntil: "load", timeout: 90_000 });
    await delay(400);
  }
  // Last resort: if Chromium still landed on Login.php, leave it for the homepage.
  if (isAuthOrLoginUrl(page.url())) {
    console.log("[storefront] forcing guest homepage away from", page.url());
    await page.goto(STORE_HOME_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  }
  await page.bringToFront().catch(() => undefined);
}

export type ScrapeStorefrontCartOptions = {
  cartUrl?: string;
};

let liveContext: BrowserContext | null = null;
let livePage: Page | null = null;
/** Window parked off-screen during Load-into-cart (same headed context; no relaunch). */
let liveOffscreen = false;

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

export type LaunchStorefrontOptions = {
  /** Park window off-screen so rebuild steps are not visible. */
  offscreen?: boolean;
};

function storefrontProfileDir(): string {
  const profileDir = process.env.VOLUSION_PLAYWRIGHT_USER_DATA_DIR?.trim() || ".playwright-volusion-profile";
  return resolve(profileDir);
}

/** Chromium leaves these behind on Windows and blocks the next launchPersistentContext. */
async function clearChromiumProfileLocks(userDataDir: string): Promise<void> {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]) {
    await unlink(join(userDataDir, name)).catch(() => undefined);
  }
}

async function closeLiveContext(): Promise<void> {
  if (liveContext) {
    try {
      await liveContext.close();
    } catch {
      /* context may already be closed */
    }
  }
  liveContext = null;
  livePage = null;
  liveOffscreen = false;
  await clearChromiumProfileLocks(storefrontProfileDir());
}

/** Outer Chromium window size. Profile Preferences.window_placement overrides --window-size. */
const STOREFRONT_WINDOW_WIDTH = 1440;
const STOREFRONT_WINDOW_HEIGHT = 1300;
const STOREFRONT_WINDOW_LEFT = 40;
const STOREFRONT_WINDOW_TOP = 40;

/**
 * Chromium persistent profile restores last window_placement (was ~900px tall).
 * Rewrite it before launch so Open Session opens tall every time.
 */
async function resetChromiumWindowPlacement(userDataDir: string): Promise<void> {
  const prefsPath = join(userDataDir, "Default", "Preferences");
  try {
    const raw = await readFile(prefsPath, "utf8");
    const prefs = JSON.parse(raw) as {
      browser?: {
        window_placement?: Record<string, unknown>;
        window_placement_popup?: Record<string, unknown>;
      };
    };
    prefs.browser = prefs.browser ?? {};
    prefs.browser.window_placement = {
      maximized: false,
      left: STOREFRONT_WINDOW_LEFT,
      top: STOREFRONT_WINDOW_TOP,
      right: STOREFRONT_WINDOW_LEFT + STOREFRONT_WINDOW_WIDTH,
      bottom: STOREFRONT_WINDOW_TOP + STOREFRONT_WINDOW_HEIGHT,
      work_area_left: 0,
      work_area_top: 0,
      work_area_right: 3440,
      work_area_bottom: 1440,
    };
    await writeFile(prefsPath, JSON.stringify(prefs), "utf8");
    console.log(
      `[storefront] reset window_placement to ${STOREFRONT_WINDOW_WIDTH}x${STOREFRONT_WINDOW_HEIGHT}`,
    );
  } catch (error) {
    // First launch / missing prefs is fine.
    console.log("[storefront] window_placement reset skipped:", error instanceof Error ? error.message : error);
  }
}

async function setBrowserWindowOnScreen(page: Page, onScreen: boolean): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = (await session.send("Browser.getWindowForTarget")) as {
      windowId: number;
    };
    // Use most of the work area height on the user's ultrawide (work_area_bottom ~1440).
    const screen = await page.evaluate(() => ({
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
    }));
    const height = Math.max(
      STOREFRONT_WINDOW_HEIGHT,
      Math.min(STOREFRONT_WINDOW_HEIGHT + 200, Math.floor(screen.availHeight - 60)),
    );
    const width = STOREFRONT_WINDOW_WIDTH;
    const bounds = onScreen
      ? {
          left: STOREFRONT_WINDOW_LEFT,
          top: STOREFRONT_WINDOW_TOP,
          width,
          height,
          windowState: "normal" as const,
        }
      : {
          left: -2400,
          top: -2400,
          width,
          height,
          windowState: "normal" as const,
        };
    await session.send("Browser.setWindowBounds", { windowId, bounds } as never);
    console.log("[storefront] window bounds applied", bounds);
    if (onScreen) {
      await page.bringToFront().catch(() => undefined);
      liveOffscreen = false;
    } else {
      liveOffscreen = true;
    }
  } catch (error) {
    console.error("[storefront] setWindowBounds failed:", error);
  }
}

async function launchPersistentStorefrontContext(
  options: LaunchStorefrontOptions = {},
): Promise<BrowserContext> {
  const offscreen = Boolean(options.offscreen);
  const userDataDir = storefrontProfileDir();
  await mkdir(userDataDir, { recursive: true });

  await closeLiveContext();
  await clearChromiumProfileLocks(userDataDir);
  // Must run while Chromium is closed — Preferences are locked while the browser is open.
  await resetChromiumWindowPlacement(userDataDir);

  // Always headed: headless→visible relaunch fights the Windows profile lock.
  // Off-screen window hides clear/product/option steps; reveal moves it on-screen.
  const args = [
    `--window-size=${STOREFRONT_WINDOW_WIDTH},${STOREFRONT_WINDOW_HEIGHT}`,
    `--window-position=${offscreen ? "-2400,-2400" : `${STOREFRONT_WINDOW_LEFT},${STOREFRONT_WINDOW_TOP}`}`,
    "--disable-session-crashed-bubble",
    "--noerrdialogs",
  ];

  liveContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args,
    viewport: null,
    userAgent:
      process.env.VOLUSION_STORE_USER_AGENT?.trim() ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  liveOffscreen = offscreen;

  // Strip leftover Login.php / auth from the persistent profile (keep CartID5).
  await clearVolusionAuthCookies(liveContext);
  await closeRestoredLoginPages(liveContext);
  console.log(`[storefront] launched ${offscreen ? "offscreen" : "visible"} persistent context`);
  return liveContext;
}

async function launchVisiblePersistentContext(): Promise<BrowserContext> {
  return launchPersistentStorefrontContext({ offscreen: false });
}

function isContextAlive(context: BrowserContext | null): boolean {
  if (!context) return false;
  try {
    // Accessing pages() throws when the browser/context was closed externally.
    void context.pages();
    return true;
  } catch {
    return false;
  }
}

export type StorefrontSessionOptions = ScrapeStorefrontCartOptions & {
  /**
   * When true, park the Chromium window off-screen (Load into cart work).
   * Prefer this over headless — same profile, no relaunch on reveal.
   */
  headless?: boolean;
  offscreen?: boolean;
};

function wantsOffscreen(options: StorefrontSessionOptions): boolean {
  if (options.offscreen !== undefined) return Boolean(options.offscreen);
  // Legacy alias: rebuild previously passed headless:true to hide the UI.
  if (options.headless !== undefined) return Boolean(options.headless);
  return liveOffscreen;
}

async function getOrCreateLiveSession(options: StorefrontSessionOptions = {}): Promise<Page> {
  const cartUrl = resolveCartUrl(options);
  const wantOffscreen = wantsOffscreen(options);

  // If Chromium was closed by the user, drop stale handles.
  if (liveContext && !isContextAlive(liveContext)) {
    liveContext = null;
    livePage = null;
    liveOffscreen = false;
  }

  if (!liveContext) {
    liveContext = await launchPersistentStorefrontContext({ offscreen: wantOffscreen });
  }

  try {
    if (!livePage || livePage.isClosed()) {
      livePage = await getOrCreateContextPage(liveContext);
      await livePage.goto(cartUrl, { waitUntil: "load", timeout: 90_000 });
      await delay(500);
    }
    if (wantOffscreen && !liveOffscreen) {
      await setBrowserWindowOnScreen(livePage, false);
    } else if (!wantOffscreen && liveOffscreen) {
      await setBrowserWindowOnScreen(livePage, true);
    }
    return livePage;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/has been closed|createTarget|Target page/i.test(message)) throw error;
    console.error("[storefront] live session dead, relaunching:", message);
    await closeLiveContext();
    liveContext = await launchPersistentStorefrontContext({ offscreen: wantOffscreen });
    livePage = await getOrCreateContextPage(liveContext);
    await livePage.goto(cartUrl, { waitUntil: "load", timeout: 90_000 });
    await delay(500);
    return livePage;
  }
}

/**
 * Open / navigate the storefront cart session.
 * Pass `{ offscreen: true }` (or legacy `headless: true`) to hide the window during rebuild.
 */
export async function openVolusionStorefrontCartSession(
  options: StorefrontSessionOptions = {},
): Promise<{ opened: true; url: string }> {
  const page = await getOrCreateLiveSession(options);
  try {
    await page.goto(resolveCartUrl(options), { waitUntil: "load", timeout: 90_000 });
    await delay(500);
    return { opened: true, url: page.url() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/has been closed|createTarget|Target page/i.test(message)) throw error;
    await closeLiveContext();
    const retry = await getOrCreateLiveSession(options);
    await retry.goto(resolveCartUrl(options), { waitUntil: "load", timeout: 90_000 });
    await delay(500);
    return { opened: true, url: retry.url() };
  }
}

/** Shared live Playwright cart page for rebuild / scrape flows. */
export async function getVolusionStorefrontLivePage(
  options: StorefrontSessionOptions = {},
): Promise<Page> {
  return getOrCreateLiveSession(options);
}

/**
 * After a hidden rebuild, move the same Chromium window on-screen onto ShoppingCart.
 * No profile relaunch (avoids Windows user-data lock).
 */
export async function revealVisibleVolusionStorefrontCart(
  options: ScrapeStorefrontCartOptions = {},
): Promise<{ opened: true; url: string }> {
  const cartUrl = resolveCartUrl(options);
  console.log("[storefront] revealing on-screen cart after hidden rebuild");

  if (!liveContext || !isContextAlive(liveContext)) {
    liveContext = null;
    livePage = null;
    liveContext = await launchPersistentStorefrontContext({ offscreen: false });
    livePage = await getOrCreateContextPage(liveContext);
  }

  if (!livePage || livePage.isClosed()) {
    livePage = await getOrCreateContextPage(liveContext);
  }

  await livePage.goto(cartUrl, { waitUntil: "load", timeout: 90_000 });
  await delay(400);
  await setBrowserWindowOnScreen(livePage, true);
  return { opened: true, url: livePage.url() };
}

/**
 * Open a manual, visible Playwright session on storefront homepage.
 * Keeps the browser/context alive for user interaction (guest cart is fine).
 */
export async function openVisibleVolusionHomepageSession(): Promise<{ opened: true; url: string }> {
  const context = await launchVisiblePersistentContext();
  livePage = await getOrCreateContextPage(context);
  await ensureGuestStorefrontPage(livePage, STORE_HOME_URL);
  // Persistent profile restores last bounds; force a tall window every open.
  await setBrowserWindowOnScreen(livePage, true);
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
    await setBrowserWindowOnScreen(page, true);
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
  livePage = await getOrCreateContextPage(context);
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
 * Prefer CartIDLog UUID from Playwright cookies (incl. HttpOnly) / storage.
 * Guest carts still have a CartIDLog GUID — no storefront login required.
 */
async function resolveAbandonedCartGuidFromLivePage(page: Page): Promise<string | null> {
  type Candidate = { guid: string; score: number; source: string };
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const push = (guid: string | null | undefined, score: number, source: string) => {
    const id = String(guid ?? "").trim();
    if (!isAbandonedCartGuid(id)) return;
    const key = id.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ guid: id, score, source });
  };

  try {
    const cookies = await page.context().cookies("https://www.xyzdisplays.com");
    for (const cookie of cookies) {
      const name = cookie.name.toLowerCase();
      const fromValue = extractAbandonedCartGuidFromText(cookie.value);
      const fromName = extractAbandonedCartGuidFromText(cookie.name);
      const cartNameBonus =
        /cart/.test(name) || name === "cartid" || name.includes("cartid") || name.includes("session")
          ? 50
          : 0;
      // Exact cookie value == GUID is the usual Volusion CartIDLog session id.
      if (isAbandonedCartGuid(cookie.value.trim())) {
        push(cookie.value.trim(), 100 + cartNameBonus, `cookie-value:${cookie.name}`);
      } else {
        push(fromValue, 80 + cartNameBonus, `cookie-embedded:${cookie.name}`);
      }
      push(fromName, 40, `cookie-name:${cookie.name}`);
    }
  } catch (error) {
    console.error("[scrape-cart] cookie GUID read failed:", error);
  }

  try {
    const fromDom = await page.evaluate(() => {
      const guidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const pick = (raw: string): string | null => {
        try {
          return decodeURIComponent(raw).match(guidRe)?.[0] ?? null;
        } catch {
          return raw.match(guidRe)?.[0] ?? null;
        }
      };
      const found: Array<{ guid: string; source: string }> = [];
      for (const part of String(document.cookie ?? "").split(";")) {
        const name = part.split("=")[0]?.trim() ?? "";
        const value = part.split("=").slice(1).join("=").trim();
        const g = pick(value);
        if (g) found.push({ guid: g, source: `document.cookie:${name}` });
      }
      const hid = document.querySelector(
        'input[name="CartID"], input[name="CartID5"], input[name="cartid"], #CartID',
      ) as HTMLInputElement | null;
      if (hid?.value && guidRe.test(hid.value.trim())) {
        found.push({ guid: hid.value.trim(), source: "hidden-CartID" });
      }
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        const g = pick(localStorage.getItem(key) ?? "") || pick(key);
        if (g) found.push({ guid: g, source: `localStorage:${key}` });
      }
      return found;
    });
    for (const row of fromDom) {
      push(row.guid, row.source.startsWith("hidden") ? 90 : 60, row.source);
    }
  } catch {
    /* ignore */
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length) {
    console.log(
      "[scrape-cart] cart GUID candidates:",
      candidates.map((c) => `${c.guid} (${c.source}, score=${c.score})`),
    );
    return candidates[0]?.guid ?? null;
  }
  return null;
}

/**
 * Scrape cart data from the live opened Playwright session.
 */
export async function scrapeVolusionStorefrontCart(
  options: StorefrontSessionOptions = {},
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
    }
  } else {
    // Prefer cookie/session GUID over line-level CartID if both exist.
    const fromSession = await resolveAbandonedCartGuidFromLivePage(page);
    if (fromSession) raw.cartId = fromSession;
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
  options: StorefrontSessionOptions = {},
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
  await closeLiveContext();
}

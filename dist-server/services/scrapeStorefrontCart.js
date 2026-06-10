"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openVolusionStorefrontCartSession = openVolusionStorefrontCartSession;
exports.openVisibleVolusionHomepageSession = openVisibleVolusionHomepageSession;
exports.openVisibleVolusionCartSession = openVisibleVolusionCartSession;
exports.scrapeVolusionStorefrontCart = scrapeVolusionStorefrontCart;
exports.clearVolusionStorefrontCart = clearVolusionStorefrontCart;
exports.closeVolusionStorefrontCartSession = closeVolusionStorefrontCartSession;
const promises_1 = require("node:timers/promises");
const promises_2 = require("node:fs/promises");
const node_path_1 = require("node:path");
const playwright_1 = require("playwright");
const extractCartFromPage_1 = require("../lib/extractCartFromPage");
const extractShippingSpeedChoiceInBrowser_1 = require("../lib/extractShippingSpeedChoiceInBrowser");
const scrapeShippingSpeedChoice_1 = require("./scrapeShippingSpeedChoice");
const DEFAULT_CART_URL = "https://www.xyzdisplays.com/ShoppingCart.asp";
const STORE_HOME_URL = "https://www.xyzdisplays.com/";
let liveContext = null;
let livePage = null;
function envHeadless(defaultValue = true) {
    const raw = process.env.VOLUSION_PLAYWRIGHT_HEADLESS?.trim().toLowerCase();
    if (!raw)
        return defaultValue;
    if (["0", "false", "no", "off"].includes(raw))
        return false;
    if (["1", "true", "yes", "on"].includes(raw))
        return true;
    return defaultValue;
}
function resolveCartUrl(options = {}) {
    return (options.cartUrl?.trim() ||
        process.env.VOLUSION_STORE_CART_URL?.trim() ||
        DEFAULT_CART_URL);
}
async function launchVisiblePersistentContext() {
    const profileDir = process.env.VOLUSION_PLAYWRIGHT_USER_DATA_DIR?.trim() || ".playwright-volusion-profile";
    const userDataDir = (0, node_path_1.resolve)(profileDir);
    await (0, promises_2.mkdir)(userDataDir, { recursive: true });
    if (liveContext) {
        try {
            await liveContext.close();
        }
        catch {
            /* context may already be closed */
        }
        liveContext = null;
        livePage = null;
    }
    liveContext = await playwright_1.chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: ["--window-size=1000,900"],
        viewport: { width: 1000, height: 900 },
        userAgent: process.env.VOLUSION_STORE_USER_AGENT?.trim() ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    return liveContext;
}
async function getOrCreateLiveSession(options = {}) {
    const profileDir = process.env.VOLUSION_PLAYWRIGHT_USER_DATA_DIR?.trim() || ".playwright-volusion-profile";
    const userDataDir = (0, node_path_1.resolve)(profileDir);
    await (0, promises_2.mkdir)(userDataDir, { recursive: true });
    const cartUrl = resolveCartUrl(options);
    // Default to headless; set 0/false/no/off to open visible browser.
    const headless = envHeadless(true);
    if (!liveContext) {
        liveContext = await playwright_1.chromium.launchPersistentContext(userDataDir, {
            headless,
            //args: ["--start-maximized"],
            args: ["--window-size=1000,900",],
            viewport: { width: 1000, height: 900 }, //viewport: null,//{ width: 1600, height: 1000 },
            userAgent: process.env.VOLUSION_STORE_USER_AGENT?.trim() ||
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });
    }
    if (!livePage || livePage.isClosed()) {
        const existing = liveContext.pages().find((p) => !p.isClosed());
        livePage = existing ?? (await liveContext.newPage());
        await livePage.goto(cartUrl, { waitUntil: "load", timeout: 90000 });
        await (0, promises_1.setTimeout)(500);
    }
    return livePage;
}
async function openVolusionStorefrontCartSession(options = {}) {
    const page = await getOrCreateLiveSession(options);
    await page.goto(resolveCartUrl(options), { waitUntil: "load", timeout: 90000 });
    await (0, promises_1.setTimeout)(500);
    return { opened: true, url: page.url() };
}
/**
 * Open a manual, visible Playwright session on storefront homepage.
 * Keeps the browser/context alive for user interaction.
 */
async function openVisibleVolusionHomepageSession() {
    const context = await launchVisiblePersistentContext();
    livePage = await context.newPage();
    await livePage.goto(STORE_HOME_URL, { waitUntil: "load", timeout: 90000 });
    return { opened: true, url: livePage.url() };
}
/**
 * Re-open or focus the live session cart page in a visible browser window.
 * Used when the user closed Chromium but the quote builder session is still ready.
 */
async function openVisibleVolusionCartSession(options = {}) {
    const cartUrl = resolveCartUrl(options);
    const navigateCart = async (page) => {
        await page.goto(cartUrl, { waitUntil: "load", timeout: 90000 });
        await (0, promises_1.setTimeout)(500);
        return { opened: true, url: page.url() };
    };
    if (liveContext) {
        try {
            if (livePage && !livePage.isClosed()) {
                return await navigateCart(livePage);
            }
            const existing = liveContext.pages().find((p) => !p.isClosed());
            livePage = existing ?? (await liveContext.newPage());
            return await navigateCart(livePage);
        }
        catch {
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
async function scrapeVolusionStorefrontCart(options = {}) {
    const cartUrl = resolveCartUrl(options);
    const page = await getOrCreateLiveSession(options);
    await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page
        .waitForSelector("#v65-cart-total-estimate-cell, .v65-cart-shipping-details-input-cell select[name='ShippingSpeedChoice'], select[name='ShippingSpeedChoice'], #v65-cart-shipping-details select, #v65-cart-table", {
        state: "attached",
        timeout: 20000,
    })
        .catch(() => {
        /* cart may still parse with fallbacks */
    });
    await page
        .waitForFunction(() => {
        function optionLabel(option) {
            return (option.label || option.textContent || "").replace(/\s+/g, " ").trim();
        }
        function isPlaceholder(label) {
            return /^please\s*select/i.test(label) || /^select\s+/i.test(label);
        }
        function looksLikeShippingOption(label) {
            if (!label || isPlaceholder(label))
                return false;
            if (/\$\s*[\d,]+(?:\.\d{1,2})?/.test(label))
                return true;
            return (/shipping|ground|overnight|freight|\b\d\s*day\b|next\s*day|2\s*day|3\s*day|ups|fedex|usps/i.test(label) && /\b[\d,]+\.\d{2}\b/.test(label));
        }
        function pricedCount(select) {
            return Array.from(select.options).filter((option) => looksLikeShippingOption(optionLabel(option))).length;
        }
        const selectors = [
            ".v65-cart-shipping-details-input-cell select[name='ShippingSpeedChoice']",
            'select.browser-default[name="ShippingSpeedChoice"]',
            'select[name="ShippingSpeedChoice"]',
            "select#ShippingSpeedChoice",
            ".v65-cart-shipping-details-input-cell select",
            "#DisplayShippingSpeedChoicesTD select",
            "#v65-cart-shipping-details select",
            "#v65-cart-shipping-details-wrapper select",
        ];
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (!el || el.tagName !== "SELECT")
                continue;
            if (pricedCount(el) >= 1)
                return true;
        }
        let best = 0;
        for (const el of Array.from(document.querySelectorAll("select"))) {
            best = Math.max(best, pricedCount(el));
        }
        return best >= 1;
    }, { timeout: 25000 })
        .catch(() => {
        /* shipping rates may still be unavailable */
    });
    await (0, promises_1.setTimeout)(1000);
    const debug = process.env.SCRAPE_CART_DEBUG === "1";
    if (debug) {
        console.error("[scrape-cart] url:", page.url());
        console.error("[scrape-cart] title:", await page.title());
        console.error("[scrape-cart] #v65-cart-table:", await page.locator("#v65-cart-table").count());
        console.error("[scrape-cart] body snippet:", (await page.content()).slice(0, 2000));
    }
    let raw = await page.evaluate(extractCartFromPage_1.extractCartPayloadInBrowser);
    const mergeDedicatedShippingScrape = async () => {
        const shippingData = (await (0, scrapeShippingSpeedChoice_1.scrapeShippingSpeedChoiceViaEval)(page)) ??
            (await (0, scrapeShippingSpeedChoice_1.scrapeShippingSpeedChoiceFromPage)(page));
        if (!shippingData?.shippingOptions.length)
            return false;
        raw.shippingOptions = shippingData.shippingOptions;
        raw.selectedShippingValue = shippingData.selectedShippingValue;
        raw.selectedShippingOption = shippingData.selectedShippingOption;
        if (shippingData.shippingTotal > 0) {
            raw.shippingTotal = shippingData.shippingTotal;
        }
        return true;
    };
    await mergeDedicatedShippingScrape();
    if (!(raw.shippingOptions?.length ?? 0)) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await (0, promises_1.setTimeout)(1000);
            await page
                .waitForSelector(extractShippingSpeedChoiceInBrowser_1.SHIPPING_SPEED_SELECT_SELECTOR, { state: "attached", timeout: 5000 })
                .catch(() => undefined);
            if (await mergeDedicatedShippingScrape())
                break;
        }
    }
    console.log("[scrape-cart] ShippingSpeedChoice:", await page.locator(extractShippingSpeedChoiceInBrowser_1.SHIPPING_SPEED_SELECT_SELECTOR).count(), "options:", raw.shippingOptions?.length ?? 0);
    if (debug) {
        console.error("[scrape-cart] shippingOptions:", raw.shippingOptions ?? []);
        console.error("[scrape-cart] selectedShippingValue:", raw.selectedShippingValue ?? null);
        console.error("[scrape-cart] selectedShippingOption:", raw.selectedShippingOption ?? null);
        console.error("[scrape-cart] shippingTotal:", raw.shippingTotal);
    }
    console.log("SCRAPED shippingOptions", raw.shippingOptions);
    return (0, extractCartFromPage_1.normalizeCartPayloadImages)(raw);
}
function resolveClearCartUrl(cartUrl) {
    const url = new URL(cartUrl);
    url.search = "";
    url.searchParams.set("ClearCart", "Y");
    return url.href;
}
/** Clear the Volusion storefront cart via ShoppingCart.asp?ClearCart=Y. */
async function clearVolusionStorefrontCart(options = {}) {
    const clearCartUrl = resolveClearCartUrl(resolveCartUrl(options));
    const page = await getOrCreateLiveSession(options);
    await page.goto(clearCartUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    console.log("[clear-cart] method: clearcart-query");
    return {
        success: true,
        removedCount: 0,
        cartEmpty: true,
        method: "clearcart-query",
    };
}
async function closeVolusionStorefrontCartSession() {
    if (liveContext) {
        await liveContext.close();
    }
    liveContext = null;
    livePage = null;
}

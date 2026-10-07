require("../lib/playwrightSetup");

import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import {
  normalizeAbandonedCartLines,
  type AbandonedCartLine,
} from "../lib/abandonedCart";
import {
  clearVolusionStorefrontCart,
  getVolusionStorefrontLivePage,
  openVolusionStorefrontCartSession,
  revealVisibleVolusionStorefrontCart,
  scrapeVolusionStorefrontCart,
} from "./scrapeStorefrontCart";
import { fetchAbandonedCartContents } from "./volusionCartIdLog";

const STORE_BASE =
  process.env.VOLUSION_STORE_BASE_URL?.trim() || "https://www.xyzdisplays.com";

export type RebuildLineResult = {
  productCode: string;
  qty: number;
  optionIds: number[];
  ok: boolean;
  error?: string;
};

export type RebuildAbandonedCartResult = {
  success: boolean;
  cartId: string;
  added: RebuildLineResult[];
  failed: RebuildLineResult[];
  cartUrl: string;
  /** Lines used for the rebuild (from CartIDLog or client snapshot). */
  sourceLines?: AbandonedCartLine[];
  /** True when CartIDLog was empty/missing and snapshot lines were used. */
  usedSnapshot?: boolean;
  /** New storefront CartID5 GUID after rebuild (ClearCart creates a new cart). */
  newCartId?: string | null;
  error?: string;
};

export type RebuildAbandonedCartOptions = {
  /** Saved quote snapshot used when CartIDLog no longer has this GUID. */
  lines?: AbandonedCartLine[] | null;
};

function productDetailsUrls(productCode: string): string[] {
  const base = STORE_BASE.replace(/\/$/, "");
  const code = encodeURIComponent(productCode);
  return [
    `${base}/ProductDetails.asp?ProductCode=${code}`,
    `${base}/ProductDetails.php?ProductCode=${code}`,
  ];
}

/**
 * Select option controls by OptionID value (select/radio/checkbox).
 * Returns how many of the requested ids were found on the page.
 */
async function selectOptionIdsOnProductPage(
  page: Page,
  optionIds: number[],
): Promise<{ selected: number; missing: number[] }> {
  if (!optionIds.length) return { selected: 0, missing: [] };

  return page.evaluate((ids) => {
    const missing: number[] = [];
    let selected = 0;

    const markInput = (el: HTMLInputElement) => {
      if (el.type === "radio" || el.type === "checkbox") {
        el.checked = true;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.click();
        return;
      }
      el.value = el.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };

    for (const rawId of ids) {
      const id = String(rawId);
      let found = false;

      // <select><option value="7358">…</option></select>
      for (const select of Array.from(document.querySelectorAll("select"))) {
        const option = select.querySelector(
          `option[value="${id}"]`,
        ) as HTMLOptionElement | null;
        if (!option) continue;
        select.value = id;
        option.selected = true;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        found = true;
        break;
      }
      if (found) {
        selected += 1;
        continue;
      }

      const candidates = Array.from(
        document.querySelectorAll(
          `input[value="${id}"], input[name="${id}"], input[id="${id}"]`,
        ),
      ) as HTMLInputElement[];
      for (const el of candidates) {
        markInput(el);
        found = true;
      }

      if (!found) {
        for (const el of Array.from(document.querySelectorAll("input")) as HTMLInputElement[]) {
          const name = (el.name || "").toLowerCase();
          if (!name.includes("option")) continue;
          if (String(el.value) === id) {
            markInput(el);
            found = true;
          }
        }
      }

      if (found) selected += 1;
      else missing.push(rawId);
    }

    return { selected, missing };
  }, optionIds);
}

async function clickUpdatePriceIfPresent(page: Page): Promise<void> {
  const btn = page
    .locator(
      'input[value*="Update Price" i], button:has-text("Update Price"), a:has-text("Update Price")',
    )
    .first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await delay(400);
  }
}

async function setQuantity(page: Page, qty: number): Promise<void> {
  const safeQty = Math.max(1, Math.trunc(qty) || 1);
  const qtySelectors = [
    'input[name="Quantity"]',
    'input[name="quantity"]',
    'input[name="Qty"]',
    'input[name="qty"]',
    'input#Quantity',
    'input#qty',
  ];
  for (const selector of qtySelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.fill(String(safeQty));
      return;
    }
  }
}

async function dismissOverlays(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const hide = (el: Element | null) => {
        if (el instanceof HTMLElement) el.style.setProperty("display", "none", "important");
      };
      hide(document.getElementById("chat-widget-container"));
      hide(document.getElementById("chat-widget"));
      hide(document.querySelector('[id*="livechat" i]'));
      hide(document.querySelector(".lc-frame"));
    })
    .catch(() => undefined);
}

async function clickAddToCart(page: Page): Promise<boolean> {
  await dismissOverlays(page);
  const selectors = [
    "#btn_addtocart",
    'input[name="btnaddtocart"]',
    'input[name="btnAddToCart"]',
    'input[value*="Add to Cart" i]',
    'input[value*="Add To Cart" i]',
    'button:has-text("Add to Cart")',
    'button:has-text("Add To Cart")',
    'a:has-text("Add to Cart")',
    'a:has-text("Add To Cart")',
    'input[type="submit"][value*="Add" i]',
    "#btnAddToCart",
    ".btn-add-to-cart",
    ".btn_addtocart",
  ];
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      try {
        await el.click({ timeout: 5_000, force: true });
        return true;
      } catch {
        // LiveChat / sticky footers often intercept; fall through to JS click.
      }
      const clicked = await el
        .evaluate((node) => {
          if (node instanceof HTMLElement) {
            node.click();
            return true;
          }
          return false;
        })
        .catch(() => false);
      if (clicked) return true;
    }
  }

  // Last resort: Volusion's own addToCart helper on the product form.
  const viaFn = await page
    .evaluate(() => {
      const btn =
        (document.getElementById("btn_addtocart") as HTMLInputElement | null) ||
        (document.querySelector('input[name="btnaddtocart"]') as HTMLInputElement | null);
      const form = btn?.form || (document.querySelector("form") as HTMLFormElement | null);
      const addFn = (window as unknown as { addToCart?: (f: HTMLFormElement, b: HTMLElement) => unknown })
        .addToCart;
      if (btn && form && typeof addFn === "function") {
        addFn(form, btn);
        return true;
      }
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  return Boolean(viaFn);
}

async function pageCartLooksEmpty(page: Page): Promise<boolean> {
  const html = await page.content();
  if (/There are no items in your shopping cart/i.test(html)) return true;
  const rows = await page.locator("#v65-cart-table tr").count().catch(() => 0);
  return rows <= 1;
}

async function pageCartHasProduct(page: Page, productCode: string): Promise<boolean> {
  if (await pageCartLooksEmpty(page)) return false;
  const needle = productCode.trim().toLowerCase();
  if (!needle) return false;
  const html = (await page.content()).toLowerCase();
  return html.includes(needle);
}

async function openProductDetailsPage(page: Page, productCode: string): Promise<boolean> {
  for (const url of productDetailsUrls(productCode)) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await delay(500);
    const title = (await page.title()).toLowerCase();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/not found|no longer available/i.test(title) && /product/i.test(bodyText)) {
      continue;
    }
    // Product page should expose qty or add-to-cart or option controls.
    const hasProductUi =
      (await page.locator('input[name="Quantity"], input[name="quantity"], #Quantity').count()) > 0 ||
      (await page.locator('input[name="btnAddToCart"], input[value*="Add to Cart" i], a:has-text("Add To Cart")').count()) >
        0 ||
      (await page.locator("select option, input[type='radio'], input[type='checkbox']").count()) > 0;
    if (hasProductUi) {
      console.log("[rebuild-cart] product page", page.url());
      return true;
    }
  }
  return false;
}

/**
 * Add one abandoned-cart line via ProductDetails:
 * select OptionID values → optional Update Price → Add To Cart.
 * (Querystring OptionIDs= on ShoppingCart.php is unreliable on this store.)
 */
export async function addAbandonedLineToStorefrontCart(
  page: Page,
  line: AbandonedCartLine,
): Promise<RebuildLineResult> {
  // Volusion ProductDetails is case-sensitive for some SKUs; CartIDLog often lowercases.
  const productCode = (line.productCode ?? "").trim().toUpperCase();
  const optionIds = line.optionIds ?? [];
  const base: RebuildLineResult = {
    productCode,
    qty: line.qty,
    optionIds,
    ok: false,
  };
  if (!productCode) {
    return { ...base, error: "Missing productCode" };
  }

  try {
    const opened = await openProductDetailsPage(page, productCode);
    if (!opened) {
      return { ...base, error: "Product page not found" };
    }

    if (optionIds.length) {
      const { selected, missing } = await selectOptionIdsOnProductPage(page, optionIds);
      console.log("[rebuild-cart] selected options", {
        productCode,
        selected,
        missing,
        optionIds,
      });
      if (selected === 0) {
        return {
          ...base,
          error: `None of the OptionIDs were found on the product page: ${optionIds.join(",")}`,
        };
      }
      await clickUpdatePriceIfPresent(page);
      // Re-select after Update Price postback (Volusion often reloads the form).
      if (missing.length < optionIds.length) {
        await selectOptionIdsOnProductPage(page, optionIds);
      }
    }

    await setQuantity(page, line.qty);
    await delay(300);

    const clicked = await clickAddToCart(page);
    if (!clicked) {
      return { ...base, error: "Add to Cart control not found" };
    }

    // Prefer waiting for cart navigation; Volusion often posts then redirects.
    await Promise.race([
      page.waitForURL(/ShoppingCart/i, { timeout: 20_000 }),
      page.waitForLoadState("domcontentloaded"),
    ]).catch(() => undefined);
    await delay(1000);

    const cartUrl = `${STORE_BASE.replace(/\/$/, "")}/ShoppingCart.php`;
    if (!/shoppingcart/i.test(page.url())) {
      console.log("[rebuild-cart] post-add url still product page:", page.url());
      await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await delay(700);
    }
    console.log("[rebuild-cart] cart url after add:", page.url());

    if (await pageCartHasProduct(page, productCode)) {
      return { ...base, ok: true };
    }

    // One more attempt: re-select options and click Add again (Volusion postback can clear selects).
    if (optionIds.length) {
      const reopened = await openProductDetailsPage(page, productCode);
      if (reopened) {
        await selectOptionIdsOnProductPage(page, optionIds);
        await clickUpdatePriceIfPresent(page);
        await selectOptionIdsOnProductPage(page, optionIds);
        await setQuantity(page, line.qty);
        await clickAddToCart(page);
        await Promise.race([
          page.waitForURL(/ShoppingCart/i, { timeout: 20_000 }),
          page.waitForLoadState("domcontentloaded"),
        ]).catch(() => undefined);
        await delay(1000);
        if (!/shoppingcart/i.test(page.url())) {
          await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await delay(700);
        }
        if (await pageCartHasProduct(page, productCode)) {
          return { ...base, ok: true };
        }
      }
    }

    return {
      ...base,
      error: "Add appeared to run but product was not found in the storefront cart",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Add to cart failed";
    return { ...base, error: message };
  }
}

export async function rebuildStorefrontCartFromAbandonedCartId(
  cartId: string,
  options: RebuildAbandonedCartOptions = {},
): Promise<RebuildAbandonedCartResult> {
  const id = cartId.trim();
  const snapshotLines = normalizeAbandonedCartLines(options.lines);
  const empty: RebuildAbandonedCartResult = {
    success: false,
    cartId: id,
    added: [],
    failed: [],
    cartUrl: "",
    ...(snapshotLines.length ? { sourceLines: snapshotLines } : {}),
  };

  try {
    // Prefer live CartIDLog. If ClearCart already deleted that GUID, use snapshot.
    let items: AbandonedCartLine[] = [];
    let usedSnapshot = false;
    try {
      const fetched = await fetchAbandonedCartContents(id);
      items = fetched.items ?? [];
    } catch (error) {
      console.error("[rebuild-cart] CartIDLog fetch failed:", error);
      items = [];
    }
    if (!items.length && snapshotLines.length) {
      items = snapshotLines;
      usedSnapshot = true;
      console.log("[rebuild-cart] using saved snapshot lines", items.length);
    }
    if (!items.length) {
      return {
        ...empty,
        error:
          "No cart contents found for this cart id (CartIDLog empty and no saved snapshot)",
      };
    }

    // Clear + ProductDetails + options run with the window off-screen.
    await openVolusionStorefrontCartSession({ offscreen: true });
    await clearVolusionStorefrontCart({ offscreen: true });
    const page = await getVolusionStorefrontLivePage({ offscreen: true });

    const added: RebuildLineResult[] = [];
    const failed: RebuildLineResult[] = [];

    for (const line of items) {
      const result = await addAbandonedLineToStorefrontCart(page, line);
      if (result.ok) added.push(result);
      else failed.push(result);
    }

    let cartEmpty = true;
    let newCartId: string | null = null;
    try {
      const scraped = await scrapeVolusionStorefrontCart({ offscreen: true });
      cartEmpty = !(scraped.cartItems?.length > 0);
      newCartId = scraped.cartId?.trim() || null;
    } catch {
      cartEmpty = await pageCartLooksEmpty(page);
    }

    // Only now open a visible window on the final ShoppingCart.
    let cartUrl = `${STORE_BASE.replace(/\/$/, "")}/ShoppingCart.php`;
    let revealError: string | undefined;
    try {
      const opened = await revealVisibleVolusionStorefrontCart();
      cartUrl = opened.url;
    } catch (error) {
      revealError = error instanceof Error ? error.message : String(error);
      console.error("[rebuild-cart] visible cart reveal failed:", revealError);
    }

    if (added.length > 0 && cartEmpty) {
      return {
        success: false,
        cartId: id,
        added: [],
        failed: added.map((row) => ({
          ...row,
          ok: false,
          error: row.error ?? "Product did not remain in storefront cart",
        })),
        cartUrl,
        sourceLines: items,
        usedSnapshot,
        newCartId,
        error: "Add reported success but the storefront cart is still empty",
      };
    }

    const ok = failed.length === 0 && added.length > 0 && !cartEmpty;
    return {
      success: ok,
      cartId: id,
      added,
      failed,
      cartUrl,
      sourceLines: items,
      usedSnapshot,
      newCartId,
      ...(failed.length && !added.length
        ? { error: "Failed to add any products to the storefront cart" }
        : revealError
          ? { error: `Cart rebuilt but visible window failed to open: ${revealError}` }
          : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rebuild failed";
    return { ...empty, error: message };
  }
}

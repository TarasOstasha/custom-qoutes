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

async function setQuantity(page: Page, qty: number, productCode: string): Promise<void> {
  const safeQty = Math.max(1, Math.trunc(qty) || 1);
  const code = productCode.trim();
  const qtySelectors = [
    ...(code
      ? [`input[name="QTY.${code}"]`, `input[name="QTY.${code.toLowerCase()}"]`]
      : []),
    'input[name^="QTY."]',
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

async function pageCartLooksEmpty(page: Page): Promise<boolean> {
  const html = await page.content();
  if (/There are no items in your shopping cart/i.test(html)) return true;
  const rows = await page.locator("#v65-cart-table tr").count().catch(() => 0);
  return rows <= 1;
}

/**
 * Post the product form the way the Add to Cart image button does.
 * addToCart() only fires a soft-add AJAX call and cancels navigation; that
 * response is a full product page, so the rebuild used to leave for the cart
 * before the item existed. form.submit() with btnaddtocart.x/y and
 * ReturnTo=ShoppingCart.php is the post this store actually adds from.
 */
async function submitProductForm(page: Page): Promise<{ ok: boolean; error?: string }> {
  const navigated = page
    .waitForURL(/ShoppingCart/i, { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);

  let started = false;
  try {
    started = await page.evaluate(() => {
      const form =
        (document.getElementById("vCSS_mainform") as HTMLFormElement | null) ||
        (document.forms.namedItem("MainForm") as HTMLFormElement | null);
      if (!form) return false;
      const ret = form.elements.namedItem("ReturnTo") as HTMLInputElement | null;
      if (ret) ret.value = "ShoppingCart.php";
      for (const [name, value] of [
        ["btnaddtocart.x", "5"],
        ["btnaddtocart.y", "5"],
      ] as const) {
        if (form.querySelector(`input[name="${name}"]`)) continue;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      form.submit();
      return true;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // form.submit() navigates immediately and can destroy the evaluate context.
    if (!/destroyed|navigation|closed/i.test(message)) {
      return { ok: false, error: message };
    }
    started = true;
  }

  if (!started) return { ok: false, error: "Add to Cart form not found" };
  await Promise.race([
    navigated,
    (async () => {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        if (/shoppingcart/i.test(page.url())) return;
        await delay(200);
      }
    })(),
  ]);
  if (!/shoppingcart/i.test(page.url())) {
    return { ok: false, error: "Storefront did not open the cart after add" };
  }
  return { ok: true };
}

async function pageCartHasProduct(page: Page, productCode: string): Promise<boolean> {
  const needle = productCode.trim().toLowerCase();
  if (!needle) return false;
  const tableText = (
    await page.locator("#v65-cart-table").innerText().catch(() => "")
  ).toLowerCase();
  if (tableText.includes(needle)) return true;
  const html = (await page.content()).toLowerCase();
  if (html.includes(`productcode=${needle}`) || html.includes(`productcode%3d${needle}`)) {
    return true;
  }
  if (await pageCartLooksEmpty(page)) return false;
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
      (await page.locator('input[name="Quantity"], input[name="quantity"], input[name^="QTY."], #Quantity').count()) >
        0 ||
      (await page.locator('input[name="btnaddtocart"], input[name="btnAddToCart"], #btn_addtocart').count()) > 0 ||
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
 * select OptionID values, set QTY.{ProductCode}, then Volusion soft-add (AJAX).
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
    }

    await setQuantity(page, line.qty, productCode);
    await delay(300);

    const cartUrl = `${STORE_BASE.replace(/\/$/, "")}/ShoppingCart.php`;
    const confirmInCart = async (): Promise<boolean> => {
      if (!/shoppingcart/i.test(page.url())) {
        await page.goto(cartUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await delay(700);
      }
      console.log("[rebuild-cart] cart url after add:", page.url());
      return pageCartHasProduct(page, productCode);
    };

    const submitted = await submitProductForm(page);
    if (!submitted.ok) {
      return { ...base, error: submitted.error ?? "Add to cart failed" };
    }
    if (await confirmInCart()) {
      return { ...base, ok: true };
    }

    const reopened = await openProductDetailsPage(page, productCode);
    if (reopened) {
      if (optionIds.length) await selectOptionIdsOnProductPage(page, optionIds);
      await setQuantity(page, line.qty, productCode);
      const retry = await submitProductForm(page);
      if (!retry.ok) {
        return { ...base, error: retry.error ?? "Add to cart failed" };
      }
      if (await confirmInCart()) {
        return { ...base, ok: true };
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
      else {
        console.error("[rebuild-cart] line failed", result);
        failed.push(result);
      }
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
        ? {
            error: `Failed to add any products to the storefront cart (${failed
              .map((row) => `${row.productCode}: ${row.error ?? "failed"}`)
              .join("; ")})`,
          }
        : revealError
          ? { error: `Cart rebuilt but visible window failed to open: ${revealError}` }
          : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rebuild failed";
    return { ...empty, error: message };
  }
}

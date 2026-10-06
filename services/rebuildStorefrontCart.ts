require("../lib/playwrightSetup");

import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import type { AbandonedCartLine } from "../lib/abandonedCart";
import {
  clearVolusionStorefrontCart,
  getVolusionStorefrontLivePage,
  openVolusionStorefrontCartSession,
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
  error?: string;
};

function productDetailsUrl(productCode: string): string {
  const base = STORE_BASE.replace(/\/$/, "");
  return `${base}/ProductDetails.php?ProductCode=${encodeURIComponent(productCode)}`;
}

async function selectOptionIdsOnProductPage(page: Page, optionIds: number[]): Promise<void> {
  if (!optionIds.length) return;

  await page.evaluate((ids) => {
    const idSet = new Set(ids.map(String));

    const mark = (el: HTMLInputElement | HTMLOptionElement | HTMLSelectElement) => {
      if (el instanceof HTMLInputElement) {
        if (el.type === "radio" || el.type === "checkbox") {
          el.checked = true;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("click", { bubbles: true }));
          return;
        }
        if (el.type === "hidden" || el.type === "text") {
          // leave as-is; value already matches
          return;
        }
      }
      if (el instanceof HTMLOptionElement) {
        el.selected = true;
        el.parentElement?.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };

    for (const id of idSet) {
      const candidates = Array.from(
        document.querySelectorAll(
          `input[value="${id}"], option[value="${id}"], input[name="${id}"], input[id="${id}"], input[name*="Option"][value="${id}"]`,
        ),
      ) as Array<HTMLInputElement | HTMLOptionElement>;

      for (const el of candidates) {
        mark(el);
      }

      // Volusion often uses checkbox/radio names containing OptionID with value = id
      const optionIdInputs = Array.from(
        document.querySelectorAll("input"),
      ) as HTMLInputElement[];
      for (const el of optionIdInputs) {
        const name = (el.name || "").toLowerCase();
        if (!name.includes("optionid") && !name.includes("option_id")) continue;
        if (String(el.value) === id) mark(el);
      }
    }
  }, optionIds);
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

async function clickAddToCart(page: Page): Promise<boolean> {
  const selectors = [
    'input[name="btnAddToCart"]',
    'input[value*="Add to Cart" i]',
    'button:has-text("Add to Cart")',
    'a:has-text("Add to Cart")',
    'input[type="submit"][value*="Add" i]',
    "#btnAddToCart",
    ".btn-add-to-cart",
  ];
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 8_000 });
      return true;
    }
  }
  return false;
}

/**
 * Add one abandoned-cart line to the live storefront session cart.
 * Uses ProductDetails + OptionID selection (values), then Add to Cart.
 */
export async function addAbandonedLineToStorefrontCart(
  page: Page,
  line: AbandonedCartLine,
): Promise<RebuildLineResult> {
  const productCode = (line.productCode ?? "").trim();
  const base: RebuildLineResult = {
    productCode,
    qty: line.qty,
    optionIds: line.optionIds ?? [],
    ok: false,
  };
  if (!productCode) {
    return { ...base, error: "Missing productCode" };
  }

  try {
    await page.goto(productDetailsUrl(productCode), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await delay(400);

    // Bail if product page looks missing
    const title = (await page.title()).toLowerCase();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/not found|no longer available|error/i.test(title) && /product/i.test(bodyText)) {
      return { ...base, error: "Product page not found" };
    }

    await selectOptionIdsOnProductPage(page, line.optionIds ?? []);
    await setQuantity(page, line.qty);

    const clicked = await clickAddToCart(page);
    if (!clicked) {
      // Fallback: ShoppingCart add URL with OptionIDs query (classic Volusion).
      const url = new URL(`${STORE_BASE.replace(/\/$/, "")}/ShoppingCart.php`);
      url.searchParams.set("ProductCode", productCode);
      url.searchParams.set("Qty", String(Math.max(1, Math.trunc(line.qty) || 1)));
      url.searchParams.set("ADD", "1");
      for (const optionId of line.optionIds ?? []) {
        url.searchParams.append("OptionIDs", String(optionId));
      }
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await delay(500);
      return { ...base, ok: true };
    }

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await delay(600);
    return { ...base, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Add to cart failed";
    return { ...base, error: message };
  }
}

export async function rebuildStorefrontCartFromAbandonedCartId(
  cartId: string,
): Promise<RebuildAbandonedCartResult> {
  const id = cartId.trim();
  const empty: RebuildAbandonedCartResult = {
    success: false,
    cartId: id,
    added: [],
    failed: [],
    cartUrl: "",
  };

  try {
    const { items } = await fetchAbandonedCartContents(id);
    if (!items.length) {
      return { ...empty, error: "No cart contents found for this cart id" };
    }

    await clearVolusionStorefrontCart();
    const page = await getVolusionStorefrontLivePage();

    const added: RebuildLineResult[] = [];
    const failed: RebuildLineResult[] = [];

    for (const line of items) {
      const result = await addAbandonedLineToStorefrontCart(page, line);
      if (result.ok) added.push(result);
      else failed.push(result);
    }

    const opened = await openVolusionStorefrontCartSession();

    // Soft verification: scrape cart; do not fail rebuild if scrape is empty (options may delay).
    try {
      await scrapeVolusionStorefrontCart();
    } catch {
      /* ignore verification errors */
    }

    return {
      success: failed.length === 0 && added.length > 0,
      cartId: id,
      added,
      failed,
      cartUrl: opened.url,
      ...(failed.length && !added.length
        ? { error: "Failed to add any products to the storefront cart" }
        : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rebuild failed";
    return { ...empty, error: message };
  }
}

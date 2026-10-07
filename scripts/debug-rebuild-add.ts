require("../lib/playwrightSetup");
require("dotenv").config();

import { setTimeout as delay } from "node:timers/promises";
import {
  clearVolusionStorefrontCart,
  closeVolusionStorefrontCartSession,
  getVolusionStorefrontLivePage,
  openVolusionStorefrontCartSession,
  scrapeVolusionStorefrontCart,
} from "../services/scrapeStorefrontCart";
import { addAbandonedLineToStorefrontCart } from "../services/rebuildStorefrontCart";

const PRODUCT = process.argv[2]?.trim() || "NV942";
const OPTION_IDS = (process.argv[3] || "7358")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => n > 0);

async function main() {
  await openVolusionStorefrontCartSession();
  await clearVolusionStorefrontCart();
  const page = await getVolusionStorefrontLivePage();

  const result = await addAbandonedLineToStorefrontCart(page, {
    productCode: PRODUCT,
    qty: 1,
    optionIds: OPTION_IDS,
  });
  console.log("add result", result);

  const opened = await openVolusionStorefrontCartSession();
  console.log("cart url", opened.url);
  const html = await page.content();
  console.log("has OCE/case text?", /oce case|oce/i.test(html));
  console.log("empty cart?", /There are no items in your shopping cart/i.test(html));

  const scraped = await scrapeVolusionStorefrontCart();
  console.log(
    "scraped",
    scraped.cartItems?.map((i) => ({
      code: i.productCode,
      price: i.unitPrice,
      options: i.options,
    })),
  );

  await delay(5000);
  await closeVolusionStorefrontCartSession();
}

void main().catch(async (e) => {
  console.error(e);
  await closeVolusionStorefrontCartSession().catch(() => undefined);
  process.exitCode = 1;
});

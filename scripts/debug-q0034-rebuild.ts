require("../lib/playwrightSetup");
require("dotenv").config();

import { rebuildStorefrontCartFromAbandonedCartId } from "../services/rebuildStorefrontCart";
import { closeVolusionStorefrontCartSession } from "../services/scrapeStorefrontCart";
import { normalizeAbandonedCartLines } from "../lib/abandonedCart";

const CART_ID =
  process.argv[2]?.trim() || "9af4f29d-5c84-405e-89a7-60c98d797692";
const SNAPSHOT = normalizeAbandonedCartLines([
  { productCode: "NV942", optionIds: [7358], qty: 1, price: 1672 },
]);

async function main() {
  console.log("rebuild Q0034 cart", CART_ID);
  const result = await rebuildStorefrontCartFromAbandonedCartId(CART_ID, {
    lines: SNAPSHOT,
  });
  console.log(JSON.stringify(result, null, 2));
  // Keep Chrome open briefly so the cart is visible.
  await new Promise((r) => setTimeout(r, 5000));
  // Do not close — leave the revealed cart window for inspection.
  // await closeVolusionStorefrontCartSession();
}

void main().catch(async (e) => {
  console.error(e);
  await closeVolusionStorefrontCartSession().catch(() => undefined);
  process.exitCode = 1;
});

/**
 * CLI: scrape Volusion ShoppingCart.asp using the persistent Chromium profile
 * (VOLUSION_PLAYWRIGHT_USER_DATA_DIR). No cookies are passed on the command line.
 *
 *   npx ts-node scripts/scrapeCart.ts
 */
import dotenv from "dotenv";
dotenv.config();

import { scrapeVolusionStorefrontCart } from "../services/scrapeStorefrontCart";

async function main() {
  const payload = await scrapeVolusionStorefrontCart();
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

require("../lib/playwrightSetup");
require("dotenv").config();

import { fetchAbandonedCartContents } from "../services/volusionCartIdLog";

const CART_ID = process.argv[2]?.trim() || "695a7ca0-cbfe-4376-9426-9662d1da6a3c";

async function main() {
  const result = await fetchAbandonedCartContents(CART_ID);
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

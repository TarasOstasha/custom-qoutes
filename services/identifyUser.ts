require("../lib/playwrightSetup");

import { findEmailForCartId } from "./volusionCartIdLog";

export async function identifyVolusionUser(
  cartId: string,
): Promise<{ cartId: string; email: string | null }> {
  const id = cartId.trim();
  if (!id) {
    throw new Error("cartId is required");
  }
  const email = await findEmailForCartId(id);
  return { cartId: id, email };
}

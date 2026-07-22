import { Op } from "sequelize";
import type { Transaction } from "sequelize";
import { Quote } from "./models";

export { duplicateQuoteNumberError } from "./quoteNumberMessages";

export async function findQuoteByNumber(
  quoteNumber: string,
  options?: { excludeQuoteId?: string; transaction?: Transaction },
): Promise<Quote | null> {
  const normalized = quoteNumber.trim();
  if (!normalized) return null;

  return Quote.findOne({
    where: {
      quoteNumber: normalized,
      ...(options?.excludeQuoteId ? { id: { [Op.ne]: options.excludeQuoteId } } : {}),
    },
    transaction: options?.transaction,
  });
}

import { QueryTypes } from "sequelize";
import { getActiveSequelize } from "./models";
import { formatSequentialQuoteNumber } from "./sequentialQuoteNumber";

const QUOTE_NUMBER_LOCK_KEY = 8142001;

/**
 * Reserves the next `Q0001`-style number. `nextval` is not rolled back, so two
 * open builders cannot receive the same number even if neither has saved yet.
 */
export async function allocateNextQuoteNumber(): Promise<string> {
  const sequelize = getActiveSequelize();
  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SELECT pg_advisory_xact_lock(:key)", {
      replacements: { key: QUOTE_NUMBER_LOCK_KEY },
      transaction,
    });
    await sequelize.query(
      "CREATE SEQUENCE IF NOT EXISTS quote_number_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1",
      { transaction },
    );
    await sequelize.query(
      `
      SELECT setval(
        'quote_number_seq',
        GREATEST(
          1,
          CASE WHEN is_called THEN last_value + 1 ELSE last_value END,
          COALESCE((
            SELECT MAX(CAST(SUBSTRING(quote_number FROM 2) AS INTEGER)) + 1
            FROM quotes
            WHERE quote_number ~ '^Q[0-9]+$'
          ), 1)
        ),
        false
      )
      FROM quote_number_seq
      `,
      { transaction },
    );
    const rows = await sequelize.query<{ n: number | string }>(
      "SELECT nextval('quote_number_seq')::int AS n",
      { transaction, type: QueryTypes.SELECT },
    );
    const n = Number(rows[0]?.n);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error("Could not assign the next quote number");
    }
    return formatSequentialQuoteNumber(n);
  });
}

require("dotenv").config();

import { Sequelize } from "sequelize";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const s = new Sequelize(url, { logging: false, dialect: "postgres" });
  try {
    const [rows] = await s.query(
      `SELECT id, quote_number, abandoned_cart_id, abandoned_cart_lines_json
       FROM quotes
       WHERE quote_number ILIKE '%0034%'
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 10`,
    );
    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await s.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

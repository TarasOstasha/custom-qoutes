require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT id, quote_number, abandoned_cart_id, abandoned_cart_lines_json
       FROM quotes
       WHERE quote_number ILIKE '%0034%'
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 10`,
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

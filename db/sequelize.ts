import { Sequelize } from "sequelize";

if (process.env.NODE_ENV !== "production") {
  try {
    require("dotenv").config({ quiet: true });
  } catch {}
}

function createSequelize(databaseUrl: string): Sequelize {
  const isSqlite = databaseUrl.startsWith("sqlite:");
  const sqliteStorage = isSqlite ? databaseUrl.replace(/^sqlite:/, "") : "";

  if (isSqlite) {
    try {
      require.resolve("sqlite3");
    } catch {
      throw new Error(
        "DATABASE_URL uses sqlite, but sqlite3 is not installed. Install sqlite3 or set a PostgreSQL DATABASE_URL.",
      );
    }

    return new Sequelize({
      dialect: "sqlite",
      storage: sqliteStorage,
      logging: false,
    });
  }

  return new Sequelize(databaseUrl, {
    dialect: "postgres",
    logging: false,
  });
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize Sequelize.");
  }
  return databaseUrl;
}

let activeSequelize = createSequelize(requireDatabaseUrl());

export function getActiveSequelize(): Sequelize {
  return activeSequelize;
}

export async function reconnectSequelize(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return false;
  }

  try {
    await activeSequelize.close();
  } catch {
    /* ignore */
  }

  activeSequelize = createSequelize(databaseUrl);

  const { Quote } = require("../lib/models/Quote") as typeof import("../lib/models/Quote");
  const { QuoteItem } = require("../lib/models/QuoteItem") as typeof import("../lib/models/QuoteItem");
  (Quote as unknown as { sequelize: Sequelize }).sequelize = activeSequelize;
  (QuoteItem as unknown as { sequelize: Sequelize }).sequelize = activeSequelize;

  await activeSequelize.authenticate();
  return true;
}

export default activeSequelize;

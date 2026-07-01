import { resolveDatabaseUrl } from "./resolveDatabaseUrl";
import { getActiveSequelize, reconnectSequelize } from "../db/sequelize";

export async function refreshDatabaseConnection(): Promise<boolean> {
  await resolveDatabaseUrl();

  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl || databaseUrl.startsWith("sqlite:")) {
    try {
      await getActiveSequelize().authenticate();
      return true;
    } catch {
      return false;
    }
  }

  try {
    return await reconnectSequelize();
  } catch (error) {
    console.error("Failed to refresh database connection:", error);
    return false;
  }
}

import { getActiveSequelize } from "./models";

const CHECK_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 30_000;
const FAILURE_CACHE_TTL_MS = 5_000;

let cachedAvailable: boolean | null = null;
let cachedAt = 0;

function usesLocalSqlite(): boolean {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  return url.startsWith("sqlite:");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Office persistence check timed out")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function probeOfficePersistence(): Promise<boolean> {
  if (usesLocalSqlite()) {
    return true;
  }

  try {
    await withTimeout(getActiveSequelize().authenticate(), CHECK_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

export async function isOfficePersistenceAvailable(forceRefresh = false): Promise<boolean> {
  const now = Date.now();
  const cacheTtl = cachedAvailable ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
  if (!forceRefresh && cachedAvailable !== null && now - cachedAt < cacheTtl) {
    return cachedAvailable;
  }

  cachedAvailable = await probeOfficePersistence();
  cachedAt = now;
  return cachedAvailable;
}

export function getCachedOfficePersistenceAvailable(): boolean | null {
  return cachedAvailable;
}

export async function refreshOfficePersistenceStatus(): Promise<boolean> {
  return isOfficePersistenceAvailable(true);
}

export const OFFLINE_PERSISTENCE_MESSAGE =
  "Quote was not saved — database is unavailable. Connect Tailscale and restart the app.";

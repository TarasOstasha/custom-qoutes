import { Sequelize } from "sequelize";

const PROBE_TIMEOUT_MS = 6_000;
const DEFAULT_LAN_HOST = "192.168.1.155";
const DEFAULT_TAILSCALE_HOST = "100.68.127.126";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Database probe timed out")), ms);
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

function getLanHost(): string {
  return process.env.DATABASE_HOST_LAN?.trim() || DEFAULT_LAN_HOST;
}

function getTailscaleHost(): string {
  return process.env.DATABASE_HOST_TAILSCALE?.trim() || DEFAULT_TAILSCALE_HOST;
}

export function getHostFromPostgresUrl(url: string): string | null {
  const match = url.match(/^postgres:\/\/[^@]+@([^:/]+)/);
  return match?.[1] ?? null;
}

export function replacePostgresHost(url: string, host: string): string | null {
  const match = url.match(/^(postgres:\/\/[^@]+@)[^:/]+((?::\d+)?\/.*)$/);
  if (!match) {
    return null;
  }
  return `${match[1]}${host}${match[2]}`;
}

function buildCandidates(): string[] {
  const primary = process.env.DATABASE_URL?.trim();
  if (!primary) {
    return [];
  }

  if (primary.startsWith("sqlite:")) {
    return [primary];
  }

  const candidates = [primary];
  const explicitLan = process.env.DATABASE_URL_LAN?.trim();
  const primaryHost = getHostFromPostgresUrl(primary);
  const alternateHost =
    primaryHost === getLanHost() ? getTailscaleHost() : getLanHost();
  const alternate = replacePostgresHost(primary, alternateHost);

  if (alternate && alternate !== primary) {
    candidates.push(alternate);
  }
  if (explicitLan && !candidates.includes(explicitLan)) {
    candidates.push(explicitLan);
  }

  return [...new Set(candidates)];
}

async function probeUrl(url: string): Promise<boolean> {
  const sequelize = new Sequelize(url, { dialect: "postgres", logging: false });
  try {
    await withTimeout(sequelize.authenticate(), PROBE_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

function redactDatabaseUrl(url: string): string {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

export async function resolveDatabaseUrl(): Promise<string | null> {
  const candidates = buildCandidates();
  if (candidates.length === 0) {
    return null;
  }

  const primary = candidates[0];
  if (!primary) {
    return null;
  }

  if (primary.startsWith("sqlite:")) {
    return primary;
  }

  const probeTasks: Array<Promise<{ url: string; host: string | null; ok: boolean }>> = [];
  for (const url of candidates) {
    const host = getHostFromPostgresUrl(url);
    probeTasks.push(probeUrl(url).then((ok) => ({ url, host, ok })));
  }

  const results = await Promise.all(probeTasks);
  const winner = results.find((result) => result.ok);

  if (winner) {
    if (winner.url !== process.env.DATABASE_URL) {
      console.log(`Database connected via ${winner.host} (${redactDatabaseUrl(winner.url)})`);
      process.env.DATABASE_URL = winner.url;
    } else {
      console.log(`Database connected via ${winner.host}`);
    }
    return winner.url;
  }

  for (const result of results) {
    console.warn(`Database unreachable at ${result.host ?? redactDatabaseUrl(result.url)}`);
  }

  console.error(
    "No database host reachable. Tried:",
    candidates.map((url) => getHostFromPostgresUrl(url) ?? redactDatabaseUrl(url)).join(", "),
  );
  return process.env.DATABASE_URL ?? null;
}

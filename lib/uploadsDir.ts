import fs from "fs";
import path from "path";
import { getHostFromPostgresUrl } from "./resolveDatabaseUrl";

function localUploadsDir(): string {
  return path.join(process.cwd(), "uploads");
}

function isUncPath(dir: string): boolean {
  return dir.startsWith("\\\\") || dir.startsWith("//");
}

function isLanPrivateHost(host: string): boolean {
  return (
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function shouldUseLocalUploadsForRemoteDb(configured: string): boolean {
  if (process.env.UPLOADS_DIR_FORCE?.trim().toLowerCase() === "true") {
    return false;
  }

  const dbHost = getHostFromPostgresUrl(process.env.DATABASE_URL?.trim() ?? "");
  if (!dbHost || !isUncPath(configured)) {
    return false;
  }

  return !isLanPrivateHost(dbHost);
}

function ensureLocalDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function ensureUncDir(dir: string): string {
  // Avoid fs.existsSync on UNC paths — it can block for a long time on Windows.
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (error) {
    throw error;
  }
}

function ensureDir(dir: string): string {
  if (isUncPath(dir)) {
    return ensureUncDir(dir);
  }
  return ensureLocalDir(dir);
}

export function getUploadsDir(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  const fallback = localUploadsDir();

  if (!configured) {
    return ensureLocalDir(fallback);
  }

  if (shouldUseLocalUploadsForRemoteDb(configured)) {
    console.info(
      `Using local uploads (${fallback}) — UPLOADS_DIR is a LAN share but DATABASE_URL uses Tailscale.`,
    );
    return ensureLocalDir(fallback);
  }

  try {
    return ensureDir(configured);
  } catch (error) {
    console.warn(
      `UPLOADS_DIR is unreachable (${configured}); using local folder ${fallback}.`,
      error instanceof Error ? error.message : error,
    );
    return ensureLocalDir(fallback);
  }
}

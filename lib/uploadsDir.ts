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

export function resolveUploadedFilePath(fileUrlOrName: string): string | null {
  const raw = fileUrlOrName.trim();
  if (!raw) return null;

  let name = raw;
  try {
    const parsed = new URL(raw, "http://localhost");
    name = path.basename(parsed.pathname);
  } catch {
    name = path.basename(raw.replace(/\\/g, "/"));
  }

  name = decodeURIComponent(name).trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) return null;

  const uploads = path.resolve(getUploadsDir());
  const full = path.resolve(uploads, name);
  const prefix = uploads.endsWith(path.sep) ? uploads : `${uploads}${path.sep}`;
  if (full !== uploads && !full.startsWith(prefix)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

import { homedir } from "node:os";
import { join } from "node:path";

/** Default Playwright browser cache location for the current OS. */
export function defaultPlaywrightBrowsersPath(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "ms-playwright");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }

  return join(homedir(), ".cache", "ms-playwright");
}

/** Cursor's agent terminal injects a sandbox cache path that has no browser binaries. */
function isCursorSandboxBrowsersPath(path: string): boolean {
  return path.includes("cursor-sandbox-cache");
}

/**
 * Resolve a usable PLAYWRIGHT_BROWSERS_PATH.
 * Keeps explicit non-sandbox paths (e.g. Electron bundled browsers).
 */
export function resolvePlaywrightBrowsersPath(): string {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();

  if (current && !isCursorSandboxBrowsersPath(current)) {
    return current;
  }

  return defaultPlaywrightBrowsersPath();
}

export function applyPlaywrightBrowsersPath(): string {
  const resolved = resolvePlaywrightBrowsersPath();
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolved;
  return resolved;
}

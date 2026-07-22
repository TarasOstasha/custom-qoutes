"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPlaywrightBrowsersPath = defaultPlaywrightBrowsersPath;
exports.resolvePlaywrightBrowsersPath = resolvePlaywrightBrowsersPath;
exports.applyPlaywrightBrowsersPath = applyPlaywrightBrowsersPath;
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
/** Default Playwright browser cache location for the current OS. */
function defaultPlaywrightBrowsersPath() {
    if (process.platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA ?? (0, node_path_1.join)((0, node_os_1.homedir)(), "AppData", "Local");
        return (0, node_path_1.join)(localAppData, "ms-playwright");
    }
    if (process.platform === "darwin") {
        return (0, node_path_1.join)((0, node_os_1.homedir)(), "Library", "Caches", "ms-playwright");
    }
    return (0, node_path_1.join)((0, node_os_1.homedir)(), ".cache", "ms-playwright");
}
/** Cursor's agent terminal injects a sandbox cache path that has no browser binaries. */
function isCursorSandboxBrowsersPath(path) {
    return path.includes("cursor-sandbox-cache");
}
/**
 * Resolve a usable PLAYWRIGHT_BROWSERS_PATH.
 * Keeps explicit non-sandbox paths (e.g. Electron bundled browsers).
 */
function resolvePlaywrightBrowsersPath() {
    const current = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
    if (current && !isCursorSandboxBrowsersPath(current)) {
        return current;
    }
    return defaultPlaywrightBrowsersPath();
}
function applyPlaywrightBrowsersPath() {
    const resolved = resolvePlaywrightBrowsersPath();
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolved;
    return resolved;
}

"use strict";

const { homedir } = require("node:os");
const { join } = require("node:path");

function defaultPlaywrightBrowsersPath() {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "ms-playwright");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }

  return join(homedir(), ".cache", "ms-playwright");
}

function resolvePlaywrightBrowsersPath() {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();

  if (current && !current.includes("cursor-sandbox-cache")) {
    return current;
  }

  return defaultPlaywrightBrowsersPath();
}

process.env.PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath();

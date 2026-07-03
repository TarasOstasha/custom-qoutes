const { ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");

const DEFAULT_UPDATE_URL = "http://100.68.127.126/updates/custom-quote/";

/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;

/** @type {boolean} */
let dismissedForSession = false;

/** @type {{
 *   status: string;
 *   currentVersion: string;
 *   newVersion: string | null;
 *   percent: number;
 *   error: string | null;
 *   dismissed: boolean;
 * }} */
let snapshot = {
  status: "idle",
  currentVersion: "",
  newVersion: null,
  percent: 0,
  error: null,
  dismissed: false,
};

function logUpdater(message, detail) {
  if (detail !== undefined) {
    console.log(`[updater] ${message}`, detail);
    return;
  }
  console.log(`[updater] ${message}`);
}

function logUpdaterError(message, error) {
  if (error !== undefined) {
    console.error(`[updater] ${message}`, error);
    return;
  }
  console.error(`[updater] ${message}`);
}

function normalizeUpdateUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return DEFAULT_UPDATE_URL;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function broadcastSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("updater:status", snapshot);
}

function setSnapshot(patch) {
  snapshot = {
    ...snapshot,
    ...patch,
    dismissed: dismissedForSession,
  };
  broadcastSnapshot();
}

function getUpdateUrl() {
  return normalizeUpdateUrl(
    process.env.UPDATE_SERVER_URL ||
      process.env.ELECTRON_UPDATE_URL ||
      DEFAULT_UPDATE_URL,
  );
}

function configureAutoUpdater() {
  autoUpdater.logger = {
    info: (message) => logUpdater(String(message)),
    warn: (message) => logUpdater(`warn: ${String(message)}`),
    error: (message) => logUpdaterError(String(message)),
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  const updateUrl = getUpdateUrl();
  autoUpdater.setFeedURL({
    provider: "generic",
    url: updateUrl,
  });

  logUpdater(`feed URL: ${updateUrl}`);
}

let ipcRegistered = false;
let eventsRegistered = false;
let checkScheduled = false;

function registerUpdaterEvents() {
  if (eventsRegistered) {
    return;
  }
  eventsRegistered = true;

  autoUpdater.on("checking-for-update", () => {
    logUpdater("checking for update");
    setSnapshot({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info) => {
    logUpdater("update available", info);
    setSnapshot({
      status: "available",
      newVersion: info.version || null,
      percent: 0,
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    logUpdater("update not available", info);
    setSnapshot({
      status: "not-available",
      newVersion: null,
      percent: 0,
      error: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent || 0);
    logUpdater(`download progress: ${percent}%`);
    setSnapshot({
      status: "downloading",
      percent,
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    logUpdater("update downloaded", info);
    setSnapshot({
      status: "downloaded",
      newVersion: info.version || snapshot.newVersion,
      percent: 100,
      error: null,
    });
  });

  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logUpdaterError("error", error);
    setSnapshot({
      status: "error",
      error: message,
    });
  });
}

function registerUpdaterIpc() {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle("updater:get-state", () => snapshot);

  ipcMain.handle("updater:download", async () => {
    logUpdater("download requested");
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logUpdaterError("download failed", error);
      setSnapshot({ status: "error", error: message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("updater:quit-and-install", () => {
    logUpdater("quit and install requested");
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle("updater:remind-later", () => {
    logUpdater("remind me later");
    dismissedForSession = true;
    setSnapshot({ dismissed: true });
  });
}

/**
 * @param {import("electron").BrowserWindow} window
 * @param {{ isPackaged: boolean, appVersion: string }} options
 */
function initAutoUpdater(window, { isPackaged, appVersion }) {
  mainWindow = window;

  if (!snapshot.currentVersion) {
    snapshot = {
      ...snapshot,
      currentVersion: appVersion,
    };
  }

  registerUpdaterIpc();

  if (!isPackaged) {
    logUpdater("skipping auto-update in unpackaged dev build");
    broadcastSnapshot();
    return;
  }

  configureAutoUpdater();
  registerUpdaterEvents();
  broadcastSnapshot();

  if (checkScheduled) {
    return;
  }
  checkScheduled = true;

  const delayMs = 5000 + Math.floor(Math.random() * 5001);
  logUpdater(`scheduling update check in ${delayMs}ms`);

  setTimeout(() => {
    logUpdater("checking for updates");
    autoUpdater.checkForUpdates().catch((error) => {
      logUpdaterError("checkForUpdates failed", error);
      setSnapshot({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, delayMs);
}

module.exports = {
  initAutoUpdater,
  getUpdateUrl,
  DEFAULT_UPDATE_URL,
};

const { app, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");
const {
  compareVersions,
  discoverAvailableVersions,
  getInstallerFileName,
  getInstallerUrl,
} = require("./versionCatalog");

const DEFAULT_UPDATE_URL = "http://100.68.127.126/updates/custom-quote/";

/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;

/** @type {boolean} */
let dismissedForSession = false;

/** @type {boolean} */
let installInFlight = false;

/** @type {{
 *   status: string;
 *   currentVersion: string;
 *   newVersion: string | null;
 *   targetVersion: string | null;
 *   installMode: "update" | "revert" | null;
 *   availableVersions: string[];
 *   percent: number;
 *   error: string | null;
 *   dismissed: boolean;
 * }} */
let snapshot = {
  status: "idle",
  currentVersion: "",
  newVersion: null,
  targetVersion: null,
  installMode: null,
  availableVersions: [],
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
  // Reverts use direct installer download; auto-update must only offer newer builds.
  autoUpdater.allowDowngrade = false;

  const updateUrl = getUpdateUrl();
  autoUpdater.setFeedURL({
    provider: "generic",
    url: updateUrl,
  });

  logUpdater(`feed URL: ${updateUrl}`);
}

/**
 * @param {string} url
 * @param {string} destination
 * @param {(percent: number) => void} onProgress
 * @returns {Promise<void>}
 */
function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        const next = new URL(response.headers.location, url).toString();
        response.resume();
        downloadFile(next, destination, onProgress).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const file = fs.createWriteStream(destination);

      response.on("data", (chunk) => {
        received += chunk.length;
        if (total > 0) {
          onProgress(Math.max(0, Math.min(100, Math.round((received / total) * 100))));
        }
      });

      response.pipe(file);

      file.on("finish", () => {
        file.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          onProgress(100);
          resolve();
        });
      });

      file.on("error", (error) => {
        fs.unlink(destination, () => undefined);
        reject(error);
      });
    });

    request.on("error", (error) => {
      fs.unlink(destination, () => undefined);
      reject(error);
    });
  });
}

async function refreshAvailableVersions() {
  try {
    const versions = await discoverAvailableVersions(getUpdateUrl(), {
      currentVersion: snapshot.currentVersion,
    });
    setSnapshot({ availableVersions: versions });
    return versions;
  } catch (error) {
    logUpdaterError("failed to discover versions", error);
    const fallback = snapshot.currentVersion ? [snapshot.currentVersion] : [];
    setSnapshot({ availableVersions: fallback });
    return fallback;
  }
}

/**
 * @param {string} targetVersion
 */
async function installSpecificVersion(targetVersion) {
  const version = String(targetVersion || "").replace(/^v/i, "").trim();
  if (!version) {
    return { ok: false, error: "Missing target version" };
  }

  if (!snapshot.currentVersion) {
    return { ok: false, error: "Current version is unknown" };
  }

  if (compareVersions(version, snapshot.currentVersion) === 0) {
    return { ok: false, error: "Already on this version" };
  }

  if (installInFlight) {
    return { ok: false, error: "An install is already in progress" };
  }

  installInFlight = true;
  const installMode =
    compareVersions(version, snapshot.currentVersion) < 0 ? "revert" : "update";
  const updateUrl = getUpdateUrl();
  const fileName = getInstallerFileName(version);
  const installerUrl = getInstallerUrl(updateUrl, fileName);
  const destination = path.join(app.getPath("temp"), fileName);

  logUpdater(`install ${installMode} requested`, { version, installerUrl });

  setSnapshot({
    status: "downloading",
    targetVersion: version,
    newVersion: version,
    installMode,
    percent: 0,
    error: null,
    dismissed: false,
  });
  dismissedForSession = false;

  try {
    await downloadFile(installerUrl, destination, (percent) => {
      setSnapshot({
        status: "downloading",
        percent,
        targetVersion: version,
        newVersion: version,
        installMode,
        error: null,
      });
    });

    setSnapshot({
      status: "downloaded",
      percent: 100,
      targetVersion: version,
      newVersion: version,
      installMode,
      error: null,
    });

    const openResult = await shell.openPath(destination);
    if (openResult) {
      throw new Error(openResult);
    }

    logUpdater("installer launched; quitting app");
    setTimeout(() => {
      app.quit();
    }, 400);

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logUpdaterError("install specific version failed", error);
    setSnapshot({
      status: "error",
      error: message,
      targetVersion: version,
      newVersion: version,
      installMode,
    });
    return { ok: false, error: message };
  } finally {
    installInFlight = false;
  }
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
    setSnapshot({ status: "checking", error: null, installMode: null });
  });

  autoUpdater.on("update-available", (info) => {
    const remoteVersion = info.version || null;
    if (
      remoteVersion &&
      snapshot.currentVersion &&
      compareVersions(remoteVersion, snapshot.currentVersion) <= 0
    ) {
      logUpdater("ignoring non-newer feed version", {
        currentVersion: snapshot.currentVersion,
        remoteVersion,
      });
      setSnapshot({
        status: "not-available",
        newVersion: null,
        targetVersion: null,
        installMode: null,
        percent: 0,
        error: null,
      });
      return;
    }

    logUpdater("update available", info);
    setSnapshot({
      status: "available",
      newVersion: remoteVersion,
      targetVersion: remoteVersion,
      installMode: "update",
      percent: 0,
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    logUpdater("update not available", info);
    setSnapshot({
      status: "not-available",
      newVersion: null,
      targetVersion: null,
      installMode: null,
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
      installMode: snapshot.installMode || "update",
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    logUpdater("update downloaded", info);
    setSnapshot({
      status: "downloaded",
      newVersion: info.version || snapshot.newVersion,
      targetVersion: info.version || snapshot.targetVersion,
      installMode: snapshot.installMode || "update",
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

  ipcMain.handle("updater:list-versions", async () => {
    const versions = await refreshAvailableVersions();
    return { ok: true, versions, currentVersion: snapshot.currentVersion };
  });

  ipcMain.handle("updater:install-version", async (_event, targetVersion) => {
    return installSpecificVersion(String(targetVersion || ""));
  });

  ipcMain.handle("updater:download", async () => {
    logUpdater("download requested");
    try {
      setSnapshot({ installMode: "update" });
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
  void refreshAvailableVersions();

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

const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const APP_URL = "http://localhost:3000";
const API_URL = "http://localhost:5000";

const rootDir = path.resolve(__dirname, "..");

let apiProcess = null;
let webProcess = null;

function startApiProcess(extraEnv = {}) {
  if (!app.isPackaged) {
    return spawn("npx", ["ts-node", "server.ts"], {
      cwd: rootDir,
      env: { ...process.env, ...extraEnv },
      shell: true,
      stdio: "inherit",
    });
  }

  // In packaged mode, run a dedicated API executable bundled with the app.
  // Expected location inside installed app resources:
  //   <resources>/api/custom-quote-api.exe
  const apiExe = path.join(process.resourcesPath, "api", "custom-quote-api.exe");
  if (!fs.existsSync(apiExe)) {
    throw new Error(`Packaged API executable not found: ${apiExe}`);
  }

  return spawn(apiExe, [], {
    cwd: path.dirname(apiExe),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
}

function startWebProcess(extraEnv = {}) {
  return spawn("npm", ["run", "dev"], {
    cwd: rootDir,
    env: { ...process.env, ...extraEnv },
    shell: true,
    stdio: "inherit",
  });
}

function waitForHttp(url, timeoutMs = 90_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(tryOnce, 600);
    };

    tryOnce();
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.webContents.openDevTools();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  apiProcess = startApiProcess({
    PORT: "5000",
    VOLUSION_PLAYWRIGHT_HEADLESS: "false",
    NEXT_PUBLIC_API_URL: API_URL,
  });

  webProcess = startWebProcess({
    NEXT_PUBLIC_API_URL: API_URL,
  });

  await waitForHttp(`${API_URL}/health`);
  await waitForHttp(APP_URL);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  apiProcess?.kill();
  webProcess?.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

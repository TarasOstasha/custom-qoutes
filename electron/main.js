const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const APP_URL = "http://localhost:3000";
const API_URL = "http://localhost:5000";

const isDev = !app.isPackaged;
const devRoot = path.resolve(__dirname, "..");
const prodAppRoot = path.join(process.resourcesPath, "app");

const playwrightBrowsersPath = isDev
  ? "0"
  : path.join(process.resourcesPath, "ms-playwright");

process.env.PLAYWRIGHT_BROWSERS_PATH = playwrightBrowsersPath;

function loadEnvironment() {
  const dotenvPath = isDev
    ? path.join(devRoot, ".env")
    : path.join(prodAppRoot, ".env");

  if (!fs.existsSync(dotenvPath)) {
    return;
  }

  try {
    const dotenv = require("dotenv");
    dotenv.config({ path: dotenvPath, override: false, quiet: true });
  } catch {
    // Ignore dotenv load errors; startup checks will surface missing config.
  }
}

function applyDatabaseFallback() {
  if (process.env.DATABASE_URL) {
    return;
  }

  try {
    require.resolve("sqlite3");
  } catch {
    return;
  }

  // Allow packaged app to run locally without PostgreSQL env setup.
  const sqliteFile = path.join(app.getPath("userData"), "custom-quote.sqlite");
  process.env.DATABASE_URL = `sqlite:${sqliteFile}`;
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

function startApiInProcess() {
  process.env.PORT = "5000";
  process.env.NEXT_PUBLIC_API_URL = API_URL;
  process.env.VOLUSION_PLAYWRIGHT_HEADLESS = "false";

  const apiEntry = isDev
    ? path.join(devRoot, "dist-server", "server.js")
    : path.join(prodAppRoot, "dist-server", "server.js");

  if (!fs.existsSync(apiEntry)) {
    throw new Error(`Missing API build output: ${apiEntry}`);
  }

  require(apiEntry);
}

function startWebInProcess() {
  process.env.PORT = "3000";
  process.env.HOSTNAME = "localhost";
  process.env.NEXT_PUBLIC_API_URL = API_URL;

  const standaloneDir = isDev
    ? path.join(devRoot, ".next", "standalone")
    : path.join(prodAppRoot, ".next", "standalone");

  const standaloneEntry = path.join(standaloneDir, "server.js");

  if (!fs.existsSync(standaloneEntry)) {
    throw new Error(
      `Missing Next standalone server: ${standaloneEntry}. Run "npm run build:prod" before packaging.`
    );
  }

  process.chdir(standaloneDir);
  require(standaloneEntry);
}

function getAppIconPath() {
  const iconPath = isDev
    ? path.join(devRoot, "public", "images", "favicon.ico")
    : path.join(prodAppRoot, "public", "images", "favicon.ico");

  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  try {
    loadEnvironment();
    applyDatabaseFallback();
    startApiInProcess();
    startWebInProcess();

    await waitForHttp(`${API_URL}/health`);
    await waitForHttp(APP_URL);

    createWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    dialog.showErrorBox(
      "Startup Error",
      `Failed to start local services.\n\n${message}`
    );

    const fallbackWindow = new BrowserWindow({
      width: 980,
      height: 700,
      autoHideMenuBar: true,
      icon: getAppIconPath(),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    fallbackWindow.loadURL(
      `data:text/html,${encodeURIComponent(`
        <h2>Custom Quote failed to start</h2>
        <pre>${message}</pre>
      `)}`
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
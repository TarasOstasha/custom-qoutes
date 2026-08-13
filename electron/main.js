const { app, BrowserWindow, dialog, shell } = require("electron");
const { initAutoUpdater } = require("./updater");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const DEFAULT_WEB_PORT = 3100;
const DEFAULT_API_PORT = 5100;

const isDev = !app.isPackaged;
const devRoot = path.resolve(__dirname, "..");
const prodAppRoot = path.join(process.resourcesPath, "app");

let appUrl = `http://localhost:${DEFAULT_WEB_PORT}`;
let apiUrl = `http://localhost:${DEFAULT_API_PORT}`;

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(preferred, label) {
  const start = Number(preferred);

  if (!Number.isInteger(start) || start <= 0) {
    throw new Error(`Invalid ${label} port: ${preferred}`);
  }

  for (let port = start; port < start + 50; port += 1) {
    if (await canBindPort(port)) {
      return port;
    }
  }

  throw new Error(`No free ${label} port found in range ${start}-${start + 49}`);
}

async function pickServicePorts() {
  const preferredApi = Number(process.env.API_PORT ?? DEFAULT_API_PORT);
  const preferredWeb = Number(process.env.WEB_PORT ?? DEFAULT_WEB_PORT);
  const apiPort = await findFreePort(preferredApi, "API");
  let webPort = await findFreePort(preferredWeb, "web");

  if (webPort === apiPort) {
    webPort = await findFreePort(webPort + 1, "web");
  }

  return { webPort, apiPort };
}

function resolvePlaywrightBrowsersPath() {
  const current = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();

  if (current && !current.includes("cursor-sandbox-cache")) {
    return current;
  }

  if (isDev) {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "ms-playwright",
    );
  }

  return path.join(process.resourcesPath, "ms-playwright");
}

process.env.PLAYWRIGHT_BROWSERS_PATH = resolvePlaywrightBrowsersPath();

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

function startApiInProcess(apiPort) {
  process.env.API_PORT = String(apiPort);
  process.env.NEXT_PUBLIC_API_URL = apiUrl;
  process.env.VOLUSION_PLAYWRIGHT_HEADLESS = "false";

  const apiEntry = isDev
    ? path.join(devRoot, "dist-server", "server.js")
    : path.join(prodAppRoot, "dist-server", "server.js");

  if (!fs.existsSync(apiEntry)) {
    throw new Error(`Missing API build output: ${apiEntry}`);
  }

  require(apiEntry);
}

function startWebInProcess(webPort) {
  process.env.PORT = String(webPort);
  process.env.HOSTNAME = "localhost";
  process.env.NEXT_PUBLIC_API_URL = apiUrl;

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
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(appUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  initAutoUpdater(mainWindow, {
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
  });

  return mainWindow;
}

app.whenReady().then(async () => {
  try {
    loadEnvironment();
    applyDatabaseFallback();

    const { webPort, apiPort } = await pickServicePorts();
    appUrl = `http://localhost:${webPort}`;
    apiUrl = `http://localhost:${apiPort}`;

    console.log(`Custom Quote web: ${appUrl}`);
    console.log(`Custom Quote API: ${apiUrl}`);

    startApiInProcess(apiPort);
    startWebInProcess(webPort);

    await waitForHttp(`${apiUrl}/health`);
    await waitForHttp(appUrl);

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
const http = require("node:http");
const https = require("node:https");

const INSTALLER_PREFIX = "Custom Quote Setup ";

/** Known published builds kept on the update server (used when versions.json is missing). */
const FALLBACK_VERSION_CANDIDATES = [
  "1.1.6",
  "1.1.5",
  "1.1.4",
  "1.1.3",
  "1.1.2",
  "1.1.1",
  "1.1.0",
  "1.0.8",
  "1.0.7",
  "1.0.6",
  "1.0.5",
  "1.0.4",
  "1.0.3",
];

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const pa = String(a || "")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b || "")
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i += 1) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }

  return 0;
}

/**
 * @param {string} version
 * @returns {string}
 */
function getInstallerFileName(version) {
  return `${INSTALLER_PREFIX}${String(version).replace(/^v/i, "")}.exe`;
}

/**
 * @param {string} baseUrl
 * @param {string} fileName
 * @returns {string}
 */
function getInstallerUrl(baseUrl, fileName) {
  const root = String(baseUrl || "").endsWith("/")
    ? String(baseUrl)
    : `${String(baseUrl)}/`;
  return new URL(encodeURI(fileName), root).toString();
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<{ statusCode: number, body: string, headers: import("node:http").IncomingHttpHeaders }>}
 */
function httpGetText(url, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        httpGetText(next, timeoutMs).then(resolve, reject);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function httpHeadOk(url, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.request(url, { method: "HEAD" }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        httpHeadOk(next, timeoutMs).then(resolve);
        return;
      }

      res.resume();
      resolve(res.statusCode === 200);
    });

    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * @param {unknown} payload
 * @returns {string[]}
 */
function parseVersionsPayload(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "version" in entry) {
          return String(/** @type {{ version: unknown }} */ (entry).version);
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof payload === "object" && payload !== null && "versions" in payload) {
    return parseVersionsPayload(
      /** @type {{ versions: unknown }} */ (payload).versions,
    );
  }

  return [];
}

/**
 * @param {string} yamlText
 * @returns {string | null}
 */
function parseLatestYmlVersion(yamlText) {
  const match = String(yamlText || "").match(/^\s*version:\s*['"]?([^\s'"]+)/m);
  return match?.[1] || null;
}

/**
 * @param {string} updateUrl
 * @param {{ currentVersion?: string }} [options]
 * @returns {Promise<string[]>}
 */
async function discoverAvailableVersions(updateUrl, options = {}) {
  const root = String(updateUrl || "").endsWith("/")
    ? String(updateUrl)
    : `${String(updateUrl)}/`;
  const found = new Set();

  if (options.currentVersion) {
    found.add(String(options.currentVersion).replace(/^v/i, ""));
  }

  try {
    const versionsResponse = await httpGetText(new URL("versions.json", root).toString());
    if (versionsResponse.statusCode === 200) {
      const parsed = JSON.parse(versionsResponse.body);
      for (const version of parseVersionsPayload(parsed)) {
        found.add(String(version).replace(/^v/i, ""));
      }
    }
  } catch {
    // Fall through to latest.yml + installer probing.
  }

  try {
    const latestResponse = await httpGetText(new URL("latest.yml", root).toString());
    if (latestResponse.statusCode === 200) {
      const latestVersion = parseLatestYmlVersion(latestResponse.body);
      if (latestVersion) {
        found.add(latestVersion);
      }
    }
  } catch {
    // Ignore latest.yml failures; probing may still find builds.
  }

  const probeResults = await Promise.all(
    FALLBACK_VERSION_CANDIDATES.map(async (version) => {
      const fileName = getInstallerFileName(version);
      const ok = await httpHeadOk(getInstallerUrl(root, fileName));
      return ok ? version : null;
    }),
  );

  for (const version of probeResults) {
    if (version) {
      found.add(version);
    }
  }

  return Array.from(found).sort(compareVersions).reverse();
}

module.exports = {
  FALLBACK_VERSION_CANDIDATES,
  INSTALLER_PREFIX,
  compareVersions,
  discoverAvailableVersions,
  getInstallerFileName,
  getInstallerUrl,
  httpGetText,
  httpHeadOk,
  parseLatestYmlVersion,
  parseVersionsPayload,
};

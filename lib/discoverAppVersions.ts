import { compareVersions } from "./versionCompare";

export const DEFAULT_UPDATE_URL =
  "http://100.68.127.126/updates/custom-quote/";

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

function normalizeUpdateUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return DEFAULT_UPDATE_URL;
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function getInstallerFileName(version: string): string {
  return `Custom Quote Setup ${String(version).replace(/^v/i, "")}.exe`;
}

function parseVersionsPayload(payload: unknown): string[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "version" in entry) {
          return String((entry as { version: unknown }).version);
        }
        return "";
      })
      .filter(Boolean);
  }

  if (typeof payload === "object" && payload !== null && "versions" in payload) {
    return parseVersionsPayload((payload as { versions: unknown }).versions);
  }

  return [];
}

function parseLatestYmlVersion(yamlText: string): string | null {
  const match = String(yamlText || "").match(/^\s*version:\s*['"]?([^\s'"]+)/m);
  return match?.[1] || null;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function discoverAppVersions(options?: {
  updateUrl?: string;
  currentVersion?: string;
}): Promise<string[]> {
  const root = normalizeUpdateUrl(
    options?.updateUrl ||
      process.env.UPDATE_SERVER_URL ||
      process.env.ELECTRON_UPDATE_URL ||
      DEFAULT_UPDATE_URL,
  );
  const found = new Set<string>();

  if (options?.currentVersion) {
    found.add(String(options.currentVersion).replace(/^v/i, ""));
  }

  try {
    const versionsResponse = await fetch(new URL("versions.json", root));
    if (versionsResponse.ok) {
      const parsed = (await versionsResponse.json()) as unknown;
      for (const version of parseVersionsPayload(parsed)) {
        found.add(String(version).replace(/^v/i, ""));
      }
    }
  } catch {
    // Fall through.
  }

  try {
    const latestResponse = await fetch(new URL("latest.yml", root));
    if (latestResponse.ok) {
      const latestVersion = parseLatestYmlVersion(await latestResponse.text());
      if (latestVersion) {
        found.add(latestVersion);
      }
    }
  } catch {
    // Fall through.
  }

  const probeResults = await Promise.all(
    FALLBACK_VERSION_CANDIDATES.map(async (version) => {
      const fileName = getInstallerFileName(version);
      const url = new URL(encodeURI(fileName), root).toString();
      return (await headOk(url)) ? version : null;
    }),
  );

  for (const version of probeResults) {
    if (version) {
      found.add(version);
    }
  }

  return Array.from(found).sort(compareVersions).reverse();
}

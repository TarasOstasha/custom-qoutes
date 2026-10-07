import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getUploadsDir } from "./uploadsDir";

export type VolusionOptionCatalogEntry = {
  id: number;
  description: string;
};

let cachedEntries: VolusionOptionCatalogEntry[] | null = null;
let cachedPath: string | null = null;

function normalizeOptionText(value: string): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip trailing [Add $xx] / price noise for looser matching. */
function normalizeOptionTextLoose(value: string): string {
  return normalizeOptionText(value)
    .replace(/\[add\s*\$[\d,.]+\s*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function findOptionsCsvPath(): string | null {
  const forced = process.env.VOLUSION_OPTIONS_CSV?.trim();
  if (forced && existsSync(forced)) return forced;

  const uploads = getUploadsDir();
  const preferred = join(uploads, "Options_ETFSJZ8QGG.csv");
  if (existsSync(preferred)) return preferred;

  try {
    const match = readdirSync(uploads).find(
      (name) => /^options.*\.csv$/i.test(name),
    );
    if (match) return join(uploads, match);
  } catch {
    /* ignore */
  }
  return null;
}

export function loadVolusionOptionsCatalog(forceReload = false): VolusionOptionCatalogEntry[] {
  if (!forceReload && cachedEntries) return cachedEntries;

  const path = findOptionsCsvPath();
  cachedPath = path;
  if (!path) {
    cachedEntries = [];
    return cachedEntries;
  }

  const raw = readFileSync(path, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    cachedEntries = [];
    return cachedEntries;
  }

  const header = parseCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  const idIdx = header.findIndex((h) => h === "id" || h === "optionid" || h === "option_id");
  const descIdx = header.findIndex(
    (h) =>
      h === "optionsdesc" ||
      h === "optiondesc" ||
      h === "description" ||
      h === "options_desc" ||
      h === "desc",
  );
  if (idIdx < 0 || descIdx < 0) {
    console.warn("[options-catalog] CSV missing id/optionsdesc columns:", path);
    cachedEntries = [];
    return cachedEntries;
  }

  const out: VolusionOptionCatalogEntry[] = [];
  const seen = new Set<number>();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i] ?? "");
    const id = Number(cells[idIdx]);
    const description = String(cells[descIdx] ?? "").trim();
    if (!Number.isFinite(id) || id <= 0 || !description) continue;
    const optionId = Math.trunc(id);
    if (seen.has(optionId)) continue;
    seen.add(optionId);
    out.push({ id: optionId, description });
  }

  cachedEntries = out;
  console.log("[options-catalog] loaded", out.length, "rows from", path);
  return out;
}

export function resolveOptionIdsFromDescriptions(
  descriptions: string[],
  catalog: VolusionOptionCatalogEntry[] = loadVolusionOptionsCatalog(),
): number[] {
  if (!descriptions.length || !catalog.length) return [];
  const byExact = new Map<string, number>();
  const byLoose = new Map<string, number>();
  for (const row of catalog) {
    byExact.set(normalizeOptionText(row.description), row.id);
    const loose = normalizeOptionTextLoose(row.description);
    if (loose && !byLoose.has(loose)) byLoose.set(loose, row.id);
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const raw of descriptions) {
    const exact = normalizeOptionText(raw);
    const loose = normalizeOptionTextLoose(raw);
    const id = byExact.get(exact) ?? byLoose.get(loose);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function getVolusionOptionsCatalogPath(): string | null {
  if (cachedPath) return cachedPath;
  return findOptionsCsvPath();
}

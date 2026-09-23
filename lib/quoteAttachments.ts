export type QuoteAttachmentKind = "file" | "image" | "screenshot";

export type QuoteInternalAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  url: string;
  kind: QuoteAttachmentKind;
  caption?: string | null;
  ocrText?: string | null;
  searchText: string;
  searchCompact?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
};

export type QuoteAttachmentSearchHit = {
  fileName: string;
  kind: QuoteAttachmentKind;
  url: string | null;
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isImageMimeType(mimeType: string | null | undefined): boolean {
  return (mimeType ?? "").toLowerCase().startsWith("image/");
}

export function isImageFileName(fileName: string): boolean {
  const i = fileName.lastIndexOf(".");
  if (i < 0) return false;
  return IMAGE_EXT.has(fileName.slice(i).toLowerCase());
}

export function guessAttachmentKind(
  mimeType: string,
  fileName: string,
  source: "paste" | "file" = "file",
): QuoteAttachmentKind {
  if (source === "paste" && (isImageMimeType(mimeType) || isImageFileName(fileName))) {
    return "screenshot";
  }
  if (isImageMimeType(mimeType) || isImageFileName(fileName)) {
    return "image";
  }
  return "file";
}

export function compactSearchBlob(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildAttachmentSearchText(parts: {
  fileName?: string | null;
  caption?: string | null;
  ocrText?: string | null;
}): string {
  return [parts.fileName, parts.caption, parts.ocrText]
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 8000);
}

export function refreshAttachmentSearchText(
  attachment: QuoteInternalAttachment,
): QuoteInternalAttachment {
  const searchText = buildAttachmentSearchText(attachment);
  return {
    ...attachment,
    searchText,
    searchCompact: compactSearchBlob(searchText).slice(0, 8000) || null,
  };
}

export function textMatchesSearchQuery(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const hay = haystack.toLowerCase();
  if (hay.includes(needle)) return true;

  const compactNeedle = compactSearchBlob(needle);
  const compactHay = compactSearchBlob(hay);
  if (compactNeedle.length >= 4 && compactHay.includes(compactNeedle)) return true;

  const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((token) => hay.includes(token) || compactHay.includes(compactSearchBlob(token)));
}

export function normalizeInternalAttachments(raw: unknown): QuoteInternalAttachment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: QuoteInternalAttachment[] = [];

  for (const entry of raw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const url = asString(rec.url ?? rec.fileUrl ?? rec.file_url).trim();
    const fileName = asString(rec.fileName ?? rec.file_name ?? rec.name).trim();
    if (!url || !fileName) continue;

    const id = asString(rec.id).trim() || url;
    if (seen.has(id)) continue;
    seen.add(id);

    const mimeType = asString(rec.mimeType ?? rec.mime_type).trim() || "application/octet-stream";
    const kindRaw = asString(rec.kind).trim().toLowerCase();
    const kind: QuoteAttachmentKind =
      kindRaw === "screenshot" || kindRaw === "image" || kindRaw === "file"
        ? kindRaw
        : guessAttachmentKind(mimeType, fileName);

    const attachment = refreshAttachmentSearchText({
      id,
      fileName,
      mimeType,
      url,
      kind,
      caption: asString(rec.caption).trim() || null,
      ocrText: asString(rec.ocrText ?? rec.ocr_text).trim() || null,
      searchText: asString(rec.searchText ?? rec.search_text),
      searchCompact: asString(rec.searchCompact ?? rec.search_compact) || null,
      sizeBytes: asNumberOrNull(rec.sizeBytes ?? rec.size_bytes),
      createdAt: asString(rec.createdAt ?? rec.created_at) || new Date().toISOString(),
    });
    out.push(attachment);
  }

  return out;
}

export function findAttachmentSearchHits(
  attachments: QuoteInternalAttachment[],
  query: string,
): QuoteAttachmentSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return attachments
    .filter((attachment) => {
      const haystack = [attachment.fileName, attachment.caption, attachment.ocrText, attachment.searchText]
        .filter(Boolean)
        .join(" ");
      return textMatchesSearchQuery(haystack, query);
    })
    .map((attachment) => ({
      fileName: attachment.fileName,
      kind: attachment.kind,
      url: attachment.kind === "file" ? null : attachment.url,
    }));
}

export function formatAttachmentSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function screenshotFileName(mimeType = "image/png"): string {
  const ext = mimeType.toLowerCase().includes("jpeg") || mimeType.toLowerCase().includes("jpg")
    ? "jpg"
    : mimeType.toLowerCase().includes("webp")
      ? "webp"
      : "png";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `screenshot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

export function likeSearchPattern(query: string): string {
  return `%${query.trim().replace(/[%_\\]/g, "")}%`;
}

export function compactLikeSearchPattern(query: string): string | null {
  const compact = compactSearchBlob(query);
  if (compact.length < 4) return null;
  return `%${compact}%`;
}

const DESC_SECONDARY_SEPARATOR = " || ";

/** Split optional line description into primary notes and additional option details. */
export function splitItemDescription(
  description: string | null | undefined,
): { primary: string; secondary: string } {
  const raw = String(description ?? "");
  const idx = raw.indexOf(DESC_SECONDARY_SEPARATOR);
  if (idx < 0) return { primary: raw, secondary: "" };
  return {
    primary: raw.slice(0, idx),
    secondary: raw.slice(idx + DESC_SECONDARY_SEPARATOR.length),
  };
}

/** Full multi-line description for preview/export (name + optional + option details). */
export function formatQuoteLineDescription(item: {
  name: string;
  description?: string | null;
}): string {
  const lines: string[] = [];
  const name = item.name?.trim();
  if (name) lines.push(name);

  const { primary, secondary } = splitItemDescription(item.description);
  if (primary.trim()) lines.push(primary.trim());
  if (secondary.trim()) lines.push(secondary.trim());

  return lines.join("\n");
}

/** Compact single-line caption for image tiles. */
export function formatQuoteLineImageCaption(item: {
  sku?: string | null;
  name: string;
  description?: string | null;
}): string {
  const lines = formatQuoteLineDescription(item).split("\n").filter(Boolean);
  if (lines.length > 0) return lines.join(" · ");
  return item.sku?.trim() || item.name?.trim() || "";
}

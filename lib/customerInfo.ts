/** Full customer block for builder / PDF / Excel / preview. */
export function formatCustomerInfoBlock(quote: {
  customerName?: string | null;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
}): string {
  const address = (quote.customerAddress ?? "").replace(/\r\n/g, "\n").trim();
  const name = (quote.customerName ?? "").trim();
  const company = (quote.customerCompany ?? "").trim();
  const email = (quote.customerEmail ?? "").trim();
  const phone = (quote.customerPhone ?? "").trim();

  const addressLines = address
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // New workflow: paste everything into the address/customer block.
  if (address && !name && !company && !email && !phone) {
    return addressLines.join("\n");
  }

  // Multi-line paste already stored in address — prefer it.
  if (addressLines.length >= 3) {
    return addressLines.join("\n");
  }

  // Legacy quotes with separate fields.
  const lines: string[] = [];
  if (company) lines.push(company);
  if (name) lines.push(name);
  if (addressLines.length) lines.push(...addressLines);
  if (phone) lines.push(phone);
  if (email) lines.push(email);
  return lines.join("\n");
}

/** Map pasted customer text into quote fields (full block + first line for search). */
export function customerInfoFromPaste(text: string): {
  customerAddress: string | null;
  customerName: string | null;
  customerCompany: null;
  customerEmail: null;
  customerPhone: null;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  const trimmed = normalized.trim();
  const firstLine =
    trimmed
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? null;

  return {
    customerAddress: trimmed || null,
    customerName: firstLine,
    customerCompany: null,
    customerEmail: null,
    customerPhone: null,
  };
}

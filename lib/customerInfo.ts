/** Full customer block for builder / PDF / Excel / preview. */
export function formatCustomerInfoBlock(quote: {
  customerName?: string | null;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
}): string {
  const rawAddress = (quote.customerAddress ?? "").replace(/\r\n/g, "\n");
  const name = (quote.customerName ?? "").trim();
  const company = (quote.customerCompany ?? "").trim();
  const email = (quote.customerEmail ?? "").trim();
  const phone = (quote.customerPhone ?? "").trim();

  const addressLines = rawAddress
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Pasted / single-block workflow: full text in customerAddress; other fields cleared.
  if (
    rawAddress &&
    !company &&
    !email &&
    !phone &&
    (!name || addressLines[0] === name)
  ) {
    return rawAddress;
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

/** Customer block plus Customer ID, for the estimate, PDF, and Excel. */
export function formatCustomerInfoDocument(quote: {
  customerName?: string | null;
  customerCompany?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerId?: string | null;
}): string {
  const lines = formatCustomerInfoBlock(quote)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const customerId = quote.customerId?.trim();
  if (customerId) lines.push(`Customer ID: ${customerId}`);
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
  const firstLine =
    normalized
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? null;

  return {
    customerAddress: normalized.trim() ? normalized : null,
    customerName: firstLine,
    customerCompany: null,
    customerEmail: null,
    customerPhone: null,
  };
}

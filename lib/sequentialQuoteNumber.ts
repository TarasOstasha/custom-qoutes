/** `Q0001`, `Q0002`, … — at least four digits, then wider as the count grows. */
export function formatSequentialQuoteNumber(value: number): string {
  const n = Math.max(1, Math.floor(value));
  return `Q${String(n).padStart(4, "0")}`;
}

/** Legacy default such as `Quote 9/30/2026`. */
export function isAutoDateQuoteNumber(quoteNumber: string): boolean {
  return /^Quote\s+\d{1,2}\/\d{1,2}\/\d{4}$/.test(quoteNumber.trim());
}

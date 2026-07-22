export function duplicateQuoteNumberError(quoteNumber: string): string {
  return `Quote number "${quoteNumber.trim()}" already exists. Choose a different quote number.`;
}

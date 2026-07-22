"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.duplicateQuoteNumberError = duplicateQuoteNumberError;
function duplicateQuoteNumberError(quoteNumber) {
    return `Quote number "${quoteNumber.trim()}" already exists. Choose a different quote number.`;
}

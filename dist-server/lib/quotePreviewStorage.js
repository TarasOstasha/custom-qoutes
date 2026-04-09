"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadQuoteDraft = exports.saveQuoteDraft = exports.QUOTE_PREVIEW_STORAGE_KEY = void 0;
exports.saveQuoteForPreview = saveQuoteForPreview;
exports.loadQuoteFromPreviewStorage = loadQuoteFromPreviewStorage;
exports.clearQuoteDraft = clearQuoteDraft;
exports.QUOTE_PREVIEW_STORAGE_KEY = "custom-quote:preview-draft";
function saveQuoteForPreview(quote) {
    if (typeof window === "undefined")
        return;
    try {
        sessionStorage.setItem(exports.QUOTE_PREVIEW_STORAGE_KEY, JSON.stringify(quote));
    }
    catch {
        /* ignore quota / private mode */
    }
}
function loadQuoteFromPreviewStorage() {
    if (typeof window === "undefined")
        return null;
    try {
        const raw = sessionStorage.getItem(exports.QUOTE_PREVIEW_STORAGE_KEY);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function clearQuoteDraft() {
    if (typeof window === "undefined")
        return;
    try {
        sessionStorage.removeItem(exports.QUOTE_PREVIEW_STORAGE_KEY);
    }
    catch {
        /* ignore */
    }
}
/** Alias for clarity — same key as preview. */
exports.saveQuoteDraft = saveQuoteForPreview;
exports.loadQuoteDraft = loadQuoteFromPreviewStorage;

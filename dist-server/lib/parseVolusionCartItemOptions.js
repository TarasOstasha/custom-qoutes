"use strict";
/** Parse Volusion Help_CartItemDetails / "Your options for" popup HTML. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractVolusionCartItemDetailsPath = extractVolusionCartItemDetailsPath;
exports.extractVolChosenOptionsList = extractVolChosenOptionsList;
exports.parseVolusionCartItemOptionsHtml = parseVolusionCartItemOptionsHtml;
/** Pull Help_CartItemDetails.asp or .php from a cart options link. */
function extractVolusionCartItemDetailsPath(rawHrefOrOnclick, fallbackLineCartId) {
    const decoded = String(rawHrefOrOnclick ?? "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    if (/Help_CartItemDetails\.(?:asp|php)/i.test(decoded)) {
        const openWindowMatch = decoded.match(/OpenNewWindow\(\s*['"]([^'"]+)['"]/i);
        const directPathMatch = decoded.match(/(Help_CartItemDetails\.(?:asp|php)(?:\?[^'"\s)]*)?)/i);
        const path = (openWindowMatch?.[1] ?? directPathMatch?.[1] ?? "").replace(/&amp;/g, "&").trim();
        if (path)
            return path;
    }
    // Newer themes: javascript:void(0) + JS fetch Help_CartItemDetails.php?CartID=<line>
    if (/view list of options/i.test(decoded) ||
        /javascript:\s*void\s*\(\s*0\s*\)/i.test(decoded) ||
        fallbackLineCartId) {
        const lineId = String(fallbackLineCartId ?? "").trim();
        if (lineId)
            return `Help_CartItemDetails.php?CartID=${encodeURIComponent(lineId)}`;
    }
    return "";
}
function normalizeOptionText(text) {
    return String(text ?? "").replace(/\s+/g, " ").trim();
}
function formatOptionPair(raw) {
    const text = normalizeOptionText(raw);
    if (!text)
        return "";
    const pairMatch = text.match(/^([^:]{1,80})\s*:\s*(.+)$/);
    if (!pairMatch)
        return text;
    const label = normalizeOptionText(pairMatch[1] ?? "");
    const value = normalizeOptionText(pairMatch[2] ?? "");
    if (!label || !value)
        return text;
    if (/^your options for$/i.test(label))
        return "";
    if (/^item\s*(name|price)$/i.test(label))
        return "";
    return `${label}: ${value}`;
}
/** Prefer `.vol-chosen-options-list li` entries from the Volusion options modal/popup. */
function extractVolChosenOptionsList(html) {
    const source = String(html ?? "");
    if (!source.trim())
        return [];
    const listMatch = source.match(/<ul\b[^>]*class=["'][^"']*vol-chosen-options-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
    const listHtml = listMatch?.[1] ?? "";
    const searchHtml = listHtml || source;
    const options = [];
    const seen = new Set();
    for (const match of searchHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const formatted = formatOptionPair(String(match[1] ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " "));
        if (!formatted || seen.has(formatted))
            continue;
        seen.add(formatted);
        options.push(formatted);
    }
    // Only trust bare <li> matches when they came from the dedicated list.
    if (listHtml)
        return options;
    return [];
}
function parseVolusionCartItemOptionsHtml(html) {
    const source = String(html ?? "");
    if (!source.trim())
        return [];
    const fromChosenList = extractVolChosenOptionsList(source);
    if (fromChosenList.length)
        return fromChosenList;
    const options = [];
    const seen = new Set();
    const linesFromHtml = (rawHtml) => {
        const withBreaks = rawHtml
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|tr|h[1-6]|td|blockquote)>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
        return withBreaks
            .split(/\r?\n+/)
            .map((line) => normalizeOptionText(line))
            .filter(Boolean);
    };
    const parseOptionLines = (lines) => {
        const parsed = [];
        for (const rawLine of lines) {
            if (/^your options for\s*:/i.test(rawLine))
                continue;
            if (/^item\s*(name|price)\s*:?/i.test(rawLine)) {
                if (parsed.length)
                    break;
                continue;
            }
            const line = rawLine.replace(/^(your\s+)?options(\s+for)?\s*:\s*/i, "").trim();
            if (!line || /^options$/i.test(line))
                continue;
            const formatted = formatOptionPair(line);
            if (formatted.includes(":")) {
                parsed.push(formatted);
                continue;
            }
            if (parsed.length > 0 && !/^options$/i.test(rawLine)) {
                const last = parsed[parsed.length - 1] ?? "";
                parsed[parsed.length - 1] = `${last} ${line}`.trim();
            }
        }
        return parsed;
    };
    const addOptions = (list) => {
        for (const opt of list) {
            if (!opt || seen.has(opt))
                continue;
            seen.add(opt);
            options.push(opt);
        }
    };
    const textLines = linesFromHtml(source);
    const startIndex = textLines.findIndex((line) => /^(your\s+)?options(\s+for)?\s*:?/i.test(line));
    if (startIndex >= 0) {
        addOptions(parseOptionLines(textLines.slice(startIndex)));
    }
    if (!options.length) {
        addOptions(parseOptionLines(textLines));
    }
    for (const match of source.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const formatted = formatOptionPair(String(match[1] ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " "));
        if (formatted)
            addOptions([formatted]);
    }
    return options;
}

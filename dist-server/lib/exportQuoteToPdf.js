"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportQuoteToPdf = exportQuoteToPdf;
const jspdf_1 = __importDefault(require("jspdf"));
const jspdf_autotable_1 = __importDefault(require("jspdf-autotable"));
const apiBase_1 = require("./apiBase");
const normalizeProductImageUrl_1 = require("./normalizeProductImageUrl");
const quoteDiscount_1 = require("./quoteDiscount");
const shippingDestination_1 = require("./shippingDestination");
const taxLabel_1 = require("./taxLabel");
function safeFilenamePart(s) {
    const t = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return t || "quote";
}
function money(value) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
/**
 * For `Label: Value` cart options, PDF shows only the value.
 * Prefers `: ` so URLs like `https://...` are left unchanged.
 */
function optionValueForPdf(raw) {
    const t = raw.trim();
    if (!t)
        return t;
    if (/^https?:\/\//i.test(t))
        return t;
    const sp = t.indexOf(": ");
    if (sp !== -1) {
        const value = t.slice(sp + 2).trim();
        return value || t;
    }
    const i = t.indexOf(":");
    if (i === -1)
        return t;
    const value = t.slice(i + 1).trim();
    return value || t;
}
function formatLineDescription(item) {
    const descPdf = item.description
        ? String(item.description)
            .split(/\r?\n/)
            .map((line) => optionValueForPdf(line))
            .join("\n")
            .trim()
        : "";
    const base = [item.name, descPdf].filter(Boolean).join("\n");
    const opts = (item.chosenOptions ?? [])
        .map((o) => optionValueForPdf(o))
        .filter(Boolean);
    if (!opts.length)
        return base;
    const optsBlock = ["Options:", ...opts.map((o) => `• ${o}`)].join("\n");
    return base ? `${base}\n\n${optsBlock}` : optsBlock;
}
function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
async function loadLogoDataUrl() {
    const candidates = [
        "/images/logo.png",
        "/images/logo.jpg",
        "/images/logo.jpeg",
        "/logo.png",
    ];
    for (const src of candidates) {
        try {
            const res = await fetch(src);
            if (!res.ok)
                continue;
            const ct = (res.headers.get("content-type") ?? "").toLowerCase();
            const mime = ct.includes("jpeg") || ct.includes("jpg")
                ? "image/jpeg"
                : ct.includes("webp")
                    ? "image/webp"
                    : ct.includes("gif")
                        ? "image/gif"
                        : "image/png";
            const buf = await res.arrayBuffer();
            return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
        }
        catch {
            // try next
        }
    }
    return null;
}
async function loadImageDataUrl(src) {
    try {
        const res = await fetch(src);
        if (!res.ok)
            return null;
        const ct = (res.headers.get("content-type") ?? "").toLowerCase();
        const mime = ct.includes("jpeg") || ct.includes("jpg")
            ? "image/jpeg"
            : ct.includes("webp")
                ? "image/webp"
                : ct.includes("gif")
                    ? "image/gif"
                    : "image/png";
        const buf = await res.arrayBuffer();
        return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    }
    catch {
        try {
            const proxied = await fetch(`${apiBase_1.apiBase}/quotes/image-proxy?url=${encodeURIComponent(src)}`);
            if (!proxied.ok)
                return null;
            const data = (await proxied.json());
            return data.dataUrl ?? null;
        }
        catch {
            return null;
        }
    }
}
async function exportQuoteToPdf(quote) {
    const doc = new jspdf_1.default({ orientation: "p", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 30;
    const logoDataUrl = await loadLogoDataUrl();
    const expoLogoDataUrl = await loadImageDataUrl("/images/quote-logo-expogoods.jpg");
    if (logoDataUrl) {
        const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
        doc.addImage(logoDataUrl, format, margin + 335, 16, 116, 38, undefined, "FAST");
    }
    if (expoLogoDataUrl) {
        const format = /^data:image\/jpe?g/i.test(expoLogoDataUrl) ? "JPEG" : "PNG";
        doc.addImage(expoLogoDataUrl, format, margin + 469, 24, 70, 34, undefined, "FAST");
    }
    let yLeft = logoDataUrl ? 64 : 34;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("170 Changebridge Rd, Bldg A7", margin, yLeft);
    yLeft += 14;
    doc.text("Montville, NJ 07045", margin, yLeft);
    yLeft += 14;
    doc.text("sales@xyzdisplays.com", margin, yLeft);
    yLeft += 14;
    doc.text("Phone: (973) 515-5151", margin, yLeft);
    // QUOTE/DATE
    const metaW = 170;
    const metaH = 44;
    const metaX = pageWidth - margin - metaW;
    const metaY = 82;
    doc.setDrawColor(156, 163, 175);
    doc.rect(metaX, metaY, metaW, metaH);
    // dividers (perfect middle)
    doc.line(metaX + metaW / 2, metaY, metaX + metaW / 2, metaY + metaH);
    doc.line(metaX, metaY + metaH / 2, metaX + metaW, metaY + metaH / 2);
    // centered Y positions
    const headerY = metaY + metaH * 0.3;
    const valueY = metaY + metaH * 0.85;
    // headers (centered in each column)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("QUOTE", metaX + metaW * 0.25, headerY, { align: "center" });
    doc.text("DATE", metaX + metaW * 0.75, headerY, { align: "center" });
    // values (centered in each column)
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(quote.quoteNumber || "—", metaX + metaW * 0.25, valueY, {
        align: "center",
    });
    doc.text(quote.quoteDate || "—", metaX + metaW * 0.75, valueY, {
        align: "center",
    });
    // bottom line stays same
    const headerBottom = Math.max(yLeft, metaY + metaH) + 14;
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, headerBottom, pageWidth - margin, headerBottom);
    // TO section
    const toX = pageWidth / 2 - 70;
    const toY = 44;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    // doc.text("TO", toX, toY, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    let yTo = toY + 18;
    doc.text(quote.customerName || "—", toX, yTo, { align: "left" });
    yTo += 14;
    if (quote.customerCompany?.trim()) {
        doc.text(quote.customerCompany, toX, yTo, { align: "left" });
        yTo += 14;
    }
    if (quote.customerAddress?.trim()) {
        const addressLines = String(quote.customerAddress)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        addressLines.forEach((line) => {
            doc.text(line, toX, yTo, { align: "left" });
            yTo += 14;
        });
    }
    if (quote.customerEmail?.trim()) {
        doc.text(quote.customerEmail, toX, yTo, { align: "left" });
        yTo += 14;
    }
    if (quote.customerPhone?.trim()) {
        doc.text(quote.customerPhone, toX, yTo, { align: "left" });
        yTo += 14;
    }
    // PRDUCT IMAGES
    // const galleryX = margin;
    // const galleryY = Math.max(headerBottom + 12, yTo + 8);
    // const galleryW = pageWidth - 2 * margin;
    // const galleryH = 118;
    // doc.setDrawColor(209, 213, 219);
    // doc.rect(galleryX, galleryY, galleryW, galleryH);
    // const galleryUrls = quote.items
    //   .map((i) => normalizeProductImageUrl(i.imageUrl) ?? i.imageUrl ?? "")
    //   .filter(Boolean)
    //   .slice(0, 4);
    // if (galleryUrls.length > 0) {
    //   const imageData = await Promise.all(galleryUrls.map((u) => loadImageDataUrl(u)));
    //   const loaded = imageData.filter((d): d is string => Boolean(d));
    //   if (loaded.length > 0) {
    //     const pad = 10;
    //     const gap = 10;
    //     const slotW = (galleryW - 2 * pad - gap * (loaded.length - 1)) / loaded.length;
    //     const imgW = Math.min(128, slotW);
    //     const imgH = 120;
    //     loaded.forEach((dataUrl, i) => {
    //       const x = galleryX + pad + i * (slotW + gap) + (slotW - imgW) / 2;
    //       const y = galleryY + (galleryH - imgH) / 2;
    //       const format = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
    //       doc.addImage(dataUrl, format, x, y, imgW, imgH, undefined, "FAST");
    //     });
    //   }
    // }
    const galleryX = margin;
    const galleryY = Math.max(headerBottom + 12, yTo + 8);
    const galleryW = pageWidth - 2 * margin;
    const imgH = 120;
    const galleryH = imgH + 28; // 14 top + 14 bottom padding
    doc.setDrawColor(209, 213, 219);
    doc.rect(galleryX, galleryY, galleryW, galleryH);
    const galleryUrls = quote.items
        .map((i) => (0, normalizeProductImageUrl_1.normalizeProductImageUrl)(i.imageUrl) ?? i.imageUrl ?? "")
        .filter(Boolean)
        .slice(0, 4);
    if (galleryUrls.length > 0) {
        const imageData = await Promise.all(galleryUrls.map((u) => loadImageDataUrl(u)));
        const loaded = imageData.filter((d) => Boolean(d));
        if (loaded.length > 0) {
            const pad = 10;
            const gap = 10;
            const slotW = (galleryW - 2 * pad - gap * (loaded.length - 1)) / loaded.length;
            const imgW = Math.min(128, slotW);
            loaded.forEach((dataUrl, i) => {
                const x = galleryX + pad + i * (slotW + gap) + (slotW - imgW) / 2;
                const y = galleryY + (galleryH - imgH) / 2;
                const format = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
                doc.addImage(dataUrl, format, x, y, imgW, imgH, undefined, "FAST");
            });
        }
    }
    const tableStartY = galleryY + galleryH + 12;
    (0, jspdf_autotable_1.default)(doc, {
        startY: tableStartY,
        margin: { left: margin, right: margin },
        head: [["Stock #", "Description", "Qty", "Unit Price", "Amount"]],
        body: quote.items.map((item) => [
            item.sku || "—",
            formatLineDescription(item),
            (0, quoteDiscount_1.isQuoteDiscountLine)(item) ? "—" : String(item.qty),
            (0, quoteDiscount_1.isQuoteDiscountLine)(item) ? (0, quoteDiscount_1.formatQuoteDiscountRate)(item) : money(item.unitPrice),
            money(item.lineTotal),
        ]),
        theme: "grid",
        styles: {
            font: "helvetica",
            fontSize: 10,
            cellPadding: 6,
            lineColor: [209, 213, 219],
            lineWidth: 0.6,
            overflow: "linebreak",
            valign: "top",
        },
        headStyles: {
            fillColor: [243, 244, 246],
            textColor: [31, 41, 55],
            fontStyle: "bold",
            halign: "left",
        },
        columnStyles: {
            0: { cellWidth: 75 },
            1: { cellWidth: 260 },
            2: { cellWidth: 50, halign: "center" },
            3: { cellWidth: 75, halign: "right" },
            4: { cellWidth: 75, halign: "right" },
        },
    });
    const tableEndY = (doc.lastAutoTable
        ?.finalY ?? tableStartY) + 8;
    const totalsXLabel = pageWidth - margin - 170;
    const totalsXValue = pageWidth - margin;
    let totalsY = tableEndY + 10;
    const drawTotal = (label, value, bold = false) => {
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(12);
        doc.text(label, totalsXLabel, totalsY, { align: "right" });
        doc.text(money(value), totalsXValue, totalsY, { align: "right" });
        totalsY += 20;
    };
    drawTotal("Subtotal", quote.subtotal);
    if (quote.discountTotal > 0)
        drawTotal("Discounts", -quote.discountTotal);
    const shippingDest = (0, shippingDestination_1.formatShippingDestination)(quote.shippingState, quote.shippingZip);
    const shippingLabel = shippingDest
        ? `Shipping to ${shippingDest.replace(/, /g, " ")}`
        : "Shipping";
    drawTotal(shippingLabel, quote.shippingTotal);
    drawTotal((0, taxLabel_1.formatTaxRowLabel)(quote.taxDescription, quote.shippingState), quote.taxTotal);
    drawTotal("TOTAL", quote.grandTotal, true);
    const notesY = totalsY + 12;
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, notesY, pageWidth - margin, notesY);
    doc.setFont("helvetica", "bold");
    doc.text("NOTES:", margin, notesY + 18);
    doc.setFont("helvetica", "normal");
    doc.text(quote.notes || "—", margin, notesY + 36);
    doc.setFontSize(11);
    doc.setTextColor(107, 114, 128);
    doc.text("Estimate Valid For 30 Days", pageWidth / 2, pageHeight - 24, {
        align: "center",
    });
    const filename = `Estimate-${safeFilenamePart(quote.quoteNumber)}.pdf`;
    doc.save(filename);
}

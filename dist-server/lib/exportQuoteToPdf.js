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
function safeFilenamePart(s) {
    const t = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return t || "quote";
}
function money(value) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
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
            // try next candidate
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
/** Export current quote to a styled PDF estimate. */
async function exportQuoteToPdf(quote) {
    const doc = new jspdf_1.default({ orientation: "p", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 30;
    const centerX = pageWidth / 2;
    const logoDataUrl = await loadLogoDataUrl();
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, "PNG", margin, 16, 116, 38, undefined, "FAST");
    }
    /** Left: Estimate + company (matches quote preview). */
    let yLeft = logoDataUrl ? 58 : 36;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Estimate", margin, yLeft);
    yLeft += 22;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("xyzDisplays", margin, yLeft);
    yLeft += 14;
    doc.text("170 Cagnesbridge Rd, Bldg A7", margin, yLeft);
    yLeft += 14;
    doc.text("Montville, NJ 07045", margin, yLeft);
    yLeft += 14;
    doc.text("sales@xyzdisplays.com", margin, yLeft);
    yLeft += 14;
    doc.text("Phone: (973) 515-5151", margin, yLeft);
    /** Right: smaller quote / date box. */
    const metaW = 148;
    const metaH = 56;
    const metaX = pageWidth - margin - metaW;
    const metaY = 36;
    doc.setDrawColor(156, 163, 175);
    doc.rect(metaX, metaY, metaW, metaH);
    doc.line(metaX + metaW / 2, metaY, metaX + metaW / 2, metaY + metaH);
    doc.line(metaX, metaY + 20, metaX + metaW, metaY + 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("QUOTE", metaX + 8, metaY + 13);
    doc.text("DATE", metaX + metaW / 2 + 6, metaY + 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(quote.quoteNumber || "—", metaX + metaW / 2 - 6, metaY + 42, { align: "right" });
    doc.text(quote.quoteDate || "—", metaX + metaW - 8, metaY + 42, { align: "right" });
    /** Center: recipient (no “TO” label), aligned with header block. */
    let yCenter = logoDataUrl ? 58 : 40;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(quote.customerName || "—", centerX, yCenter, { align: "center" });
    yCenter += 14;
    if (quote.customerCompany?.trim()) {
        doc.text(quote.customerCompany, centerX, yCenter, { align: "center" });
        yCenter += 14;
    }
    if (quote.customerAddress?.trim()) {
        const addrLines = doc.splitTextToSize(quote.customerAddress, 220);
        addrLines.forEach((line) => {
            doc.text(line, centerX, yCenter, { align: "center" });
            yCenter += 12;
        });
    }
    if (quote.customerEmail?.trim()) {
        doc.text(quote.customerEmail, centerX, yCenter, { align: "center" });
        yCenter += 14;
    }
    if (quote.customerPhone?.trim()) {
        doc.text(quote.customerPhone, centerX, yCenter, { align: "center" });
        yCenter += 14;
    }
    const headerBottom = Math.max(yLeft, yCenter, metaY + metaH) + 12;
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, headerBottom, pageWidth - margin, headerBottom);
    /** Full-width image gallery — larger thumbnails. */
    const galleryX = margin;
    const galleryY = headerBottom + 14;
    const galleryW = pageWidth - 2 * margin;
    const galleryH = 118;
    doc.setDrawColor(209, 213, 219);
    doc.rect(galleryX, galleryY, galleryW, galleryH);
    const galleryUrls = quote.items
        .map((i) => (0, normalizeProductImageUrl_1.normalizeProductImageUrl)(i.imageUrl) ?? i.imageUrl ?? "")
        .filter(Boolean)
        .slice(0, 3);
    if (galleryUrls.length > 0) {
        const imageData = await Promise.all(galleryUrls.map((u) => loadImageDataUrl(u)));
        const loaded = imageData.filter((d) => Boolean(d));
        const pad = 12;
        const gap = 10;
        const n = loaded.length;
        const innerW = galleryW - 2 * pad;
        const slotW = n > 0 ? (innerW - (n - 1) * gap) / n : innerW;
        const imgH = Math.min(galleryH - 2 * pad, slotW * 0.72);
        loaded.forEach((dataUrl, drawIndex) => {
            const x = galleryX + pad + drawIndex * (slotW + gap);
            const yImg = galleryY + pad + (galleryH - 2 * pad - imgH) / 2;
            const format = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
            doc.addImage(dataUrl, format, x, yImg, slotW, imgH, undefined, "FAST");
        });
        if (loaded.length === 0) {
            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.text("Product images unavailable", galleryX + pad, galleryY + galleryH / 2);
            doc.setTextColor(0, 0, 0);
        }
    }
    else {
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        doc.text("No product images", galleryX + 12, galleryY + galleryH / 2);
        doc.setTextColor(0, 0, 0);
    }
    const tableStartY = galleryY + galleryH + 16;
    (0, jspdf_autotable_1.default)(doc, {
        startY: tableStartY,
        margin: { left: 14, right: margin },
        head: [["Stock #", "Description", "Qty", "Unit Price", "Amount"]],
        body: quote.items.map((item) => [
            item.sku || "—",
            [item.name, item.description].filter(Boolean).join("\n"),
            String(item.qty),
            money(item.unitPrice),
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
            0: { cellWidth: 80 },
            1: { cellWidth: 280 },
            2: { cellWidth: 55, halign: "center" },
            3: { cellWidth: 80, halign: "right" },
            4: { cellWidth: 80, halign: "right" },
        },
    });
    const tableEndY = (doc.lastAutoTable?.finalY ?? tableStartY) + 8;
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
    drawTotal("Shipping", quote.shippingTotal);
    drawTotal("Sales Tax", quote.taxTotal);
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
    doc.text("Estimate Valid For 30 Days", pageWidth / 2, doc.internal.pageSize.getHeight() - 24, {
        align: "center",
    });
    const filename = `Estimate-${safeFilenamePart(quote.quoteNumber)}.pdf`;
    doc.save(filename);
}

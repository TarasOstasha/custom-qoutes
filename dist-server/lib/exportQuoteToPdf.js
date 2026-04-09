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
    let y = 36;
    const logoDataUrl = await loadLogoDataUrl();
    if (logoDataUrl) {
        doc.addImage(logoDataUrl, "PNG", margin, 16, 116, 38, undefined, "FAST");
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    y += 24;
    if (logoDataUrl)
        y += 18;
    doc.text("170 Cagnesbridge Rd, Bldg A7", margin, y);
    y += 14;
    doc.text("Montville, NJ 07045", margin, y);
    y += 14;
    doc.text("sales@xyzdisplays.com", margin, y);
    y += 14;
    doc.text("Phone: (973) 515-5151", margin, y);
    const metaX = pageWidth - 220 - margin;
    const metaY = 30;
    const metaW = 220;
    const metaH = 90;
    doc.setDrawColor(156, 163, 175);
    doc.rect(metaX, metaY, metaW, metaH);
    doc.line(metaX + metaW / 2, metaY, metaX + metaW / 2, metaY + metaH);
    doc.line(metaX, metaY + 30, metaX + metaW, metaY + 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("QUOTE", metaX + 10, metaY + 18);
    doc.text("DATE", metaX + metaW / 2 + 10, metaY + 18);
    doc.setFont("helvetica", "normal");
    doc.text(quote.quoteNumber || "—", metaX + metaW / 2 - 10, metaY + 54, { align: "right" });
    doc.text(quote.quoteDate || "—", metaX + metaW - 10, metaY + 54, { align: "right" });
    y += 34;
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, y, pageWidth - margin, y);
    y += 24;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("TO", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    y += 18;
    doc.text(quote.customerName || "—", margin, y);
    y += 14;
    doc.text(quote.customerCompany || "", margin, y);
    y += 14;
    doc.text(quote.customerEmail || "", margin, y);
    y += 14;
    doc.text(quote.customerPhone || "", margin, y);
    const galleryX = 210;
    const galleryY = 162;
    const galleryW = pageWidth - margin - galleryX;
    const galleryH = 82;
    doc.setDrawColor(209, 213, 219);
    doc.rect(galleryX, galleryY, galleryW, galleryH);
    const galleryUrls = quote.items
        .map((i) => (0, normalizeProductImageUrl_1.normalizeProductImageUrl)(i.imageUrl) ?? i.imageUrl ?? "")
        .filter(Boolean)
        .slice(0, 3);
    if (galleryUrls.length > 0) {
        const imageData = await Promise.all(galleryUrls.map((u) => loadImageDataUrl(u)));
        let drawIndex = 0;
        imageData.forEach((dataUrl) => {
            if (!dataUrl)
                return;
            const x = galleryX + 10 + drawIndex * 92;
            const yImg = galleryY + 9;
            const format = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";
            doc.addImage(dataUrl, format, x, yImg, 76, 64, undefined, "FAST");
            drawIndex += 1;
        });
        if (drawIndex === 0) {
            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.text("Product images unavailable", galleryX + 10, galleryY + 22);
            doc.setTextColor(0, 0, 0);
        }
    }
    else {
        doc.setFontSize(10);
        doc.setTextColor(107, 114, 128);
        doc.text("No product images", galleryX + 10, galleryY + 22);
        doc.setTextColor(0, 0, 0);
    }
    y += 14;
    (0, jspdf_autotable_1.default)(doc, {
        startY: y,
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
    const tableEndY = (doc.lastAutoTable?.finalY ?? y) + 8;
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

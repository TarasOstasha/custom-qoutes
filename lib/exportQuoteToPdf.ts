import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { getApiBase } from "./apiBase";
import { formatCustomerInfoBlock } from "./customerInfo";
import { formatEstimateValidLabel, type Quote } from "./mockQuote";
import { normalizeProductImageUrl } from "./normalizeProductImageUrl";
import { formatQuoteDiscountRate, isQuoteDiscountLine } from "./quoteDiscount";
import { getQuoteItemImageUrls } from "./quoteItemImages";
import { formatShippingTotalLabel } from "./shippingMethod";
import { formatTaxRowLabel, quoteGrandTotalIsTbd } from "./taxLabel";

function safeFilenamePart(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return t || "quote";
}

function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * For `Label: Value` cart options, PDF shows only the value.
 * Prefers `: ` so URLs like `https://...` are left unchanged.
 */
function optionValueForPdf(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;

  const sp = t.indexOf(": ");
  if (sp !== -1) {
    const value = t.slice(sp + 2).trim();
    return value || t;
  }

  const i = t.indexOf(":");
  if (i === -1) return t;
  const value = t.slice(i + 1).trim();
  return value || t;
}

type PdfDescriptionParts = {
  title: string;
  optionText: string;
  fullText: string;
};

type DescriptionCellInput = {
  content: string;
  title: string;
  optionText: string;
  drawnCount?: number;
};

function getPdfDescriptionParts(item: {
  name: string;
  description?: string | null;
  chosenOptions?: string[] | null;
}): PdfDescriptionParts {
  const title = item.name ? String(item.name) : "";
  const descPdf = item.description
    ? String(item.description)
        .split(/\r?\n/)
        .map((line) => optionValueForPdf(line))
        .join("\n")
        .trim()
    : "";
  const opts = (item.chosenOptions ?? [])
    .map((o) => optionValueForPdf(o))
    .filter(Boolean);

  let optionText = descPdf;
  if (opts.length) {
    const optsBlock = ["Options:", ...opts.map((o) => `• ${o}`)].join("\n");
    optionText = optionText ? `${optionText}\n\n${optsBlock}` : optsBlock;
  }

  const fullText = [title, optionText].filter(Boolean).join("\n");
  return { title, optionText, fullText };
}

function isDescriptionCellInput(raw: unknown): raw is DescriptionCellInput {
  return (
    !!raw &&
    typeof raw === "object" &&
    "title" in raw &&
    "optionText" in raw &&
    typeof (raw as DescriptionCellInput).title === "string" &&
    typeof (raw as DescriptionCellInput).optionText === "string"
  );
}

function wrapPdfText(doc: jsPDF, text: string, maxWidth: number, fontSize: number): string[] {
  if (!text) return [];
  const wrapped = doc.splitTextToSize(text, maxWidth, { fontSize });
  return Array.isArray(wrapped) ? wrapped : [wrapped];
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadLogoDataUrl(): Promise<string | null> {
  const candidates = [
    "/images/logo.png",
    "/images/logo.jpg",
    "/images/logo.jpeg",
    "/logo.png",
  ];
  for (const src of candidates) {
    try {
      const res = await fetch(src);
      if (!res.ok) continue;
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const mime =
        ct.includes("jpeg") || ct.includes("jpg")
          ? "image/jpeg"
          : ct.includes("webp")
            ? "image/webp"
            : ct.includes("gif")
              ? "image/gif"
              : "image/png";
      const buf = await res.arrayBuffer();
      return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
    } catch {
      // try next
    }
  }
  return null;
}

function isUploadedImageUrl(url: string): boolean {
  return /\/api\/uploads\//i.test(url);
}

function getDataUrlDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

/** object-fit: contain within a fixed box, centered. */
function containFitRect(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): { offsetX: number; offsetY: number; drawW: number; drawH: number } {
  if (naturalW <= 0 || naturalH <= 0) {
    return { offsetX: 0, offsetY: 0, drawW: boxW, drawH: boxH };
  }
  const scale = Math.min(boxW / naturalW, boxH / naturalH);
  const drawW = naturalW * scale;
  const drawH = naturalH * scale;
  return {
    offsetX: (boxW - drawW) / 2,
    offsetY: (boxH - drawH) / 2,
    drawW,
    drawH,
  };
}

/** Empty gallery slots to the right of `colIndex` in the same row (for wider upload contain). */
function trailingEmptySlotsInRow(
  colIndex: number,
  rowIndex: number,
  imageCount: number,
  perRow: number,
): number {
  const rowStart = rowIndex * perRow;
  const rowEnd = Math.min(rowStart + perRow, imageCount);
  let span = 1;
  for (let col = colIndex + 1; col < perRow; col++) {
    if (rowStart + col < rowEnd) break;
    span++;
  }
  return span;
}

async function loadImageDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const mime =
      ct.includes("jpeg") || ct.includes("jpg")
        ? "image/jpeg"
        : ct.includes("webp")
          ? "image/webp"
          : ct.includes("gif")
            ? "image/gif"
            : "image/png";
    const buf = await res.arrayBuffer();
    return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    try {
      const proxied = await fetch(
        `${getApiBase()}/quotes/image-proxy?url=${encodeURIComponent(src)}`,
      );
      if (!proxied.ok) return null;
      const data = (await proxied.json()) as { dataUrl?: string };
      return data.dataUrl ?? null;
    } catch {
      return null;
    }
  }
}

export async function exportQuoteToPdf(quote: Quote): Promise<void> {
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 30;

  const logoDataUrl = await loadLogoDataUrl();
  const expoLogoDataUrl = await loadImageDataUrl(
    "/images/quote-logo-expogoods.jpg",
  );
  if (logoDataUrl) {
    const format = /^data:image\/jpe?g/i.test(logoDataUrl) ? "JPEG" : "PNG";
    doc.addImage(
      logoDataUrl, 
      format, 
      margin + 335, 
      16, 116, 38, 
      undefined, "FAST"
    );
  }
  if (expoLogoDataUrl) {
    const format = /^data:image\/jpe?g/i.test(expoLogoDataUrl) ? "JPEG" : "PNG";
    doc.addImage(
      expoLogoDataUrl,
      format,
      margin + 469,
      24,
      70,
      34,
      undefined,
      "FAST",
    );
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

  // TO section: keep customer text in the middle column so it never overlaps QUOTE/DATE
  const toX = margin + 175;
  const toY = 44;
  const maxCustomerWidth = Math.max(80, metaX - toX - 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  let yTo = toY + 18;
  const customerLines = formatCustomerInfoBlock(quote)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const wrappedCustomerLines =
    customerLines.length === 0
      ? ["—"]
      : customerLines.flatMap((line) => wrapPdfText(doc, line, maxCustomerWidth, 11));
  wrappedCustomerLines.forEach((line) => {
    doc.text(line, toX, yTo, { align: "left" });
    yTo += 14;
  });

  // Extra clearance so the rule sits below customer email descenders
  const headerBottom = Math.max(yLeft, metaY + metaH, yTo) + 20;
  doc.setDrawColor(209, 213, 219);
  doc.line(margin, headerBottom, pageWidth - margin, headerBottom);

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

  const galleryUrls = quote.items
    .flatMap((i) => getQuoteItemImageUrls(i))
    .map((url) => normalizeProductImageUrl(url) ?? url)
    .filter(Boolean);

  const pad = 10;
  const gap = 10;
  const imgH = 120;
  const rowGap = 8;
  const perRow = 4;
  const slotW = (galleryW - 2 * pad - gap * (perRow - 1)) / perRow;
  const imgW = Math.min(128, slotW);
  const numRows =
    galleryUrls.length > 0 ? Math.ceil(galleryUrls.length / perRow) : 0;
  const galleryH =
    numRows > 0 ? numRows * imgH + (numRows - 1) * rowGap + 28 : imgH + 28;

  doc.setDrawColor(209, 213, 219);
  doc.rect(galleryX, galleryY, galleryW, galleryH);

  if (galleryUrls.length > 0) {
    const imageEntries = await Promise.all(
      galleryUrls.map(async (url) => ({
        url,
        dataUrl: await loadImageDataUrl(url),
      })),
    );
    const loaded = imageEntries.filter(
      (entry): entry is { url: string; dataUrl: string } =>
        Boolean(entry.dataUrl),
    );
    if (loaded.length > 0) {
      for (let i = 0; i < loaded.length; i++) {
        const { url, dataUrl } = loaded[i]!;
        const rowIndex = Math.floor(i / perRow);
        const colIndex = i % perRow;
        const boxX = galleryX + pad + colIndex * (slotW + gap);
        const boxY = galleryY + 14 + rowIndex * (imgH + rowGap);
        const format = /^data:image\/jpe?g/i.test(dataUrl) ? "JPEG" : "PNG";

        if (isUploadedImageUrl(url)) {
          try {
            const { width, height } = await getDataUrlDimensions(dataUrl);
            const span =
              width > height
                ? trailingEmptySlotsInRow(
                    colIndex,
                    rowIndex,
                    loaded.length,
                    perRow,
                  )
                : 1;
            const uploadBoxW = span * slotW + (span - 1) * gap;
            const fit = containFitRect(width, height, uploadBoxW, imgH);
            doc.addImage(
              dataUrl,
              format,
              boxX + fit.offsetX,
              boxY + fit.offsetY,
              fit.drawW,
              fit.drawH,
              undefined,
              "FAST",
            );
          } catch {
            doc.addImage(dataUrl, format, boxX, boxY, imgW, imgH, undefined, "FAST");
          }
        } else {
          doc.addImage(dataUrl, format, boxX, boxY, imgW, imgH, undefined, "FAST");
        }
      }
    }
  }

  const tableStartY = galleryY + galleryH + 12;
  const descriptionPageLines = new WeakMap<object, { start: number; lines: string[] }>();
  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [["Stock #", "Description", "Qty", "Unit Price", "Amount"]],
    body: quote.items.map((item) => {
      const parts = getPdfDescriptionParts(item);
      const descriptionCell: string | DescriptionCellInput = parts.optionText
        ? { content: parts.fullText, title: parts.title, optionText: parts.optionText }
        : parts.fullText;
      return [
        item.sku || "—",
        descriptionCell,
        isQuoteDiscountLine(item) ? "—" : String(item.qty),
        isQuoteDiscountLine(item) ? formatQuoteDiscountRate(item) : money(item.unitPrice),
        money(item.lineTotal),
      ];
    }),
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
    willDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 1) return;
      const raw = data.cell.raw;
      if (!isDescriptionCellInput(raw) || !raw.optionText) return;
      const lines = [...data.cell.text];
      const start = raw.drawnCount ?? 0;
      raw.drawnCount = start + lines.length;
      descriptionPageLines.set(data.cell, { start, lines });
      data.cell.text = [];
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 1) return;
      const raw = data.cell.raw;
      if (!isDescriptionCellInput(raw) || !raw.optionText) return;
      const page = descriptionPageLines.get(data.cell);
      if (!page?.lines.length) return;

      const font = data.cell.styles.font || "helvetica";
      const fontSize = data.cell.styles.fontSize;
      const scaleFactor = doc.internal.scaleFactor;
      const maxWidth =
        data.cell.width - data.cell.padding("horizontal") + 1 / scaleFactor;

      doc.setFont(font, "normal");
      doc.setFontSize(fontSize);
      const titleCount = wrapPdfText(doc, raw.title, maxWidth, fontSize).length;

      const pos = data.cell.getTextPos();
      const physicalLineHeight = 1.15;
      const lineHeight = fontSize * doc.getLineHeightFactor();
      let y = pos.y + fontSize * (2 - physicalLineHeight);

      for (let i = 0; i < page.lines.length; i++) {
        const italic = page.start + i >= titleCount;
        doc.setFont(font, italic ? "italic" : "normal");
        doc.setFontSize(fontSize);
        doc.text(page.lines[i] ?? "", pos.x, y);
        y += lineHeight;
      }
    },
  });

  const tableEndY =
    ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY ?? tableStartY) + 8;

  const totalsXLabel = pageWidth - margin - 170;
  const totalsXValue = pageWidth - margin;
  let totalsY = tableEndY + 10;
  const drawTotal = (
    label: string,
    value: number,
    opts?: { bold?: boolean; textValue?: string | null },
  ) => {
    const bold = opts?.bold ?? false;
    const display = opts?.textValue?.trim() ? opts.textValue.trim() : money(value);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(12);
    doc.text(label, totalsXLabel, totalsY, { align: "right" });
    doc.text(display, totalsXValue, totalsY, { align: "right" });
    totalsY += 20;
  };
  drawTotal("Subtotal", quote.subtotal);
  if (quote.discountTotal > 0) drawTotal("Discounts", -quote.discountTotal);
  drawTotal(formatShippingTotalLabel(quote), quote.shippingTotal, {
    textValue: quote.shippingLabel?.trim() || null,
  });
  drawTotal(formatTaxRowLabel(quote.taxDescription, quote.shippingState), quote.taxTotal, {
    textValue: quote.taxLabel?.trim() || null,
  });
  drawTotal("TOTAL", quote.grandTotal, {
    bold: true,
    textValue: quoteGrandTotalIsTbd(quote) ? "TBD" : null,
  });

  const notesY = totalsY + 12;
  doc.setDrawColor(209, 213, 219);
  doc.line(margin, notesY, pageWidth - margin, notesY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("NOTES:", margin, notesY + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const notesMaxWidth = pageWidth - margin * 2;
  const notesLineHeight = 14;
  const notesBottomLimit = pageHeight - 40;
  const notesText = (quote.notes || "—").trim() || "—";
  const notesLines = doc.splitTextToSize(notesText, notesMaxWidth) as string[];

  let noteLineY = notesY + 36;
  for (const line of notesLines) {
    if (noteLineY > notesBottomLimit) {
      doc.addPage();
      noteLineY = margin + 18;
    }
    doc.text(line, margin, noteLineY);
    noteLineY += notesLineHeight;
  }

  doc.setFontSize(11);
  doc.setTextColor(107, 114, 128);
  doc.text(formatEstimateValidLabel(quote.estimateValidDays), pageWidth / 2, pageHeight - 24, {
    align: "center",
  });

  const filename = `Estimate-${safeFilenamePart(quote.quoteNumber)}.pdf`;
  doc.save(filename);
}

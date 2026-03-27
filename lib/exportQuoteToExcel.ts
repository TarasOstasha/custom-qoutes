import ExcelJS from "exceljs";
import type { Quote } from "./mockQuote";
import { normalizeProductImageUrl } from "./normalizeProductImageUrl";

function safeFilenamePart(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return t || "quote";
}

const BORDER_GRAY: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FF9CA3AF" },
};

const allSides = {
  top: BORDER_GRAY,
  left: BORDER_GRAY,
  bottom: BORDER_GRAY,
  right: BORDER_GRAY,
} as ExcelJS.Borders;

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFB8D4EF" },
};

const MONEY_FMT = '"$"#,##0.00';

function applyBorderRange(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      ws.getCell(r, c).border = {
        top: BORDER_GRAY,
        bottom: BORDER_GRAY,
        left: BORDER_GRAY,
        right: BORDER_GRAY,
      };
    }
  }
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

async function fetchImageForExcel(
  url: string
): Promise<{ base64: string; extension: "jpeg" | "png" | "gif" } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    let extension: "jpeg" | "png" | "gif" = "jpeg";
    if (ct.includes("png")) extension = "png";
    else if (ct.includes("gif")) extension = "gif";
    return { base64: arrayBufferToBase64(buf), extension };
  } catch {
    return null;
  }
}

/** Builds a styled .xlsx matching the on-screen estimate layout. */
export async function exportQuoteToExcel(quote: Quote): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "custom-quote";
  const ws = workbook.addWorksheet("Estimate");

  ws.columns = [
    { width: 14 },
    { width: 44 },
    { width: 8 },
    { width: 14 },
    { width: 14 },
  ];

  let row = 1;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "Estimate";
  ws.getCell(`A${row}`).font = { bold: true, size: 16 };
  ws.getCell(`D${row}`).value = "QUOTE";
  ws.getCell(`D${row}`).font = { bold: true };
  ws.getCell(`E${row}`).value = quote.quoteNumber;
  ws.getCell(`E${row}`).alignment = { horizontal: "right" };
  row += 1;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "xyzDisplays";
  ws.getCell(`A${row}`).font = { bold: true, size: 11 };
  ws.getCell(`D${row}`).value = "DATE";
  ws.getCell(`D${row}`).font = { bold: true };
  ws.getCell(`E${row}`).value = quote.quoteDate;
  ws.getCell(`E${row}`).alignment = { horizontal: "right" };
  applyBorderRange(ws, 1, 4, 2, 5);
  row += 1;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "170 Cagnesbridge Rd, Bldg A7";
  row += 1;
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "Montville, NJ 07045";
  row += 1;
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "sales@xyzdisplays.com";
  row += 1;
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "Phone: (973) 515-5151";
  row += 1;

  row += 1;

  const toBlockStart = row;
  ws.getCell(`A${row}`).value = "TO";
  ws.getCell(`A${row}`).font = { bold: true };
  ws.mergeCells(`D${toBlockStart}:E${toBlockStart + 3}`);
  const galleryCell = ws.getCell(`D${toBlockStart}`);
  galleryCell.value = "Product images";
  galleryCell.alignment = { vertical: "top", horizontal: "center", wrapText: true };
  galleryCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF3F4F6" },
  };
  applyBorderRange(ws, toBlockStart, 4, toBlockStart + 3, 5);
  row += 1;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = quote.customerName ?? "—";
  row += 1;
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = quote.customerCompany ?? "";
  row += 1;
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = quote.customerEmail ?? "";
  row += 1;
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = quote.customerPhone ?? "";
  row += 1;

  const galleryItems = quote.items
    .filter((i) => Boolean(i.imageUrl?.trim()))
    .slice(0, 3);
  const galleryUrls = galleryItems.map(
    (i) => normalizeProductImageUrl(i.imageUrl) ?? i.imageUrl ?? ""
  );

  const galleryResults = await Promise.all(
    galleryUrls.map((u) => (u ? fetchImageForExcel(u) : Promise.resolve(null)))
  );
  let embeddedGallery = 0;
  galleryUrls.forEach((url, i) => {
    if (!url) return;
    const img = galleryResults[i];
    if (!img) return;
    const imageId = workbook.addImage({
      base64: img.base64,
      extension: img.extension,
    });
    ws.addImage(imageId, {
      tl: { col: 3 + embeddedGallery * 0.95, row: toBlockStart - 1 + 0.06 },
      ext: { width: 100, height: 82 },
    });
    embeddedGallery += 1;
  });

  const anyGalleryUrl = galleryUrls.some(Boolean);
  const anyGalleryImage = galleryResults.some((r, i) => galleryUrls[i] && r !== null);
  if (anyGalleryUrl && !anyGalleryImage) {
    galleryCell.value = galleryUrls.filter(Boolean).join("\n");
  } else if (embeddedGallery > 0) {
    galleryCell.value = "";
  }

  row += 1;

  const headerRow = row;
  const hr = ws.getRow(headerRow);
  hr.getCell(1).value = "Stock #";
  hr.getCell(2).value = "DESCRIPTION";
  hr.getCell(3).value = "QTY";
  hr.getCell(4).value = "UNIT PRICE";
  hr.getCell(5).value = "AMOUNT";
  hr.font = { bold: true, color: { argb: "FF374151" } };
  hr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  hr.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
  hr.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
  hr.getCell(4).alignment = { horizontal: "right", vertical: "middle" };
  hr.getCell(5).alignment = { horizontal: "right", vertical: "middle" };
  hr.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { ...allSides };
  });
  hr.height = 22;
  row += 1;

  for (const item of quote.items) {
    const desc = [item.name, item.description].filter(Boolean).join("\n");
    const r = ws.getRow(row);
    r.getCell(1).value = item.sku ?? "—";
    r.getCell(1).alignment = { vertical: "top", horizontal: "left" };
    r.getCell(2).value = desc;
    r.getCell(2).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    r.getCell(3).value = item.qty;
    r.getCell(3).alignment = { horizontal: "center", vertical: "top" };
    r.getCell(4).value = item.unitPrice;
    r.getCell(4).numFmt = MONEY_FMT;
    r.getCell(4).alignment = { horizontal: "right", vertical: "top" };
    r.getCell(5).value = item.lineTotal;
    r.getCell(5).numFmt = MONEY_FMT;
    r.getCell(5).alignment = { horizontal: "right", vertical: "top" };
    r.height = Math.max(36, Math.min(120, 16 + desc.split("\n").length * 14));

    const url = item.imageUrl?.trim()
      ? normalizeProductImageUrl(item.imageUrl) ?? item.imageUrl
      : "";
    if (url) {
      const embedded = await fetchImageForExcel(url);
      if (embedded) {
        const imageId = workbook.addImage({
          base64: embedded.base64,
          extension: embedded.extension,
        });
        ws.addImage(imageId, {
          tl: { col: 1.02, row: row - 1 + 0.02 },
          ext: { width: 36, height: 36 },
        });
      }
    }
    row += 1;
  }

  const labelCol = 4;
  const valueCol = 5;

  const addTotalRow = (label: string, value: number, opts?: { bold?: boolean; thickTop?: boolean }) => {
    const rr = ws.getRow(row);
    rr.getCell(labelCol).value = label;
    rr.getCell(labelCol).alignment = { horizontal: "right" };
    rr.getCell(valueCol).value = value;
    rr.getCell(valueCol).numFmt = MONEY_FMT;
    rr.getCell(valueCol).alignment = { horizontal: "right" };
    if (opts?.bold) {
      rr.getCell(labelCol).font = { bold: true };
      rr.getCell(valueCol).font = { bold: true };
    }
    if (opts?.thickTop) {
      rr.getCell(labelCol).border = { top: { style: "medium", color: { argb: "FF6B7280" } } };
      rr.getCell(valueCol).border = { top: { style: "medium", color: { argb: "FF6B7280" } } };
    }
    row += 1;
  };

  addTotalRow("Subtotal", quote.subtotal);
  if (quote.discountTotal > 0) {
    addTotalRow("Discounts", -quote.discountTotal);
  }
  addTotalRow("Shipping", quote.shippingTotal);
  addTotalRow("Sales Tax", quote.taxTotal);
  addTotalRow("TOTAL", quote.grandTotal, { bold: true, thickTop: true });

  row += 1;
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = "NOTES:";
  ws.getCell(`A${row}`).font = { bold: true };
  row += 1;
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = quote.notes ?? "";
  ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = Math.max(40, 20 + (quote.notes ?? "").split("\n").length * 16);

  row += 1;
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = "Estimate Valid For 30 Days";
  ws.getCell(`A${row}`).alignment = { horizontal: "center" };
  ws.getCell(`A${row}`).font = { color: { argb: "FF6B7280" } };

  ws.views = [{ state: "frozen", ySplit: headerRow }];

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `Estimate-${safeFilenamePart(quote.quoteNumber)}.xlsx`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

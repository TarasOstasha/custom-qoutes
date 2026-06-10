import ExcelJS from "exceljs";
import { apiBase } from "./apiBase";
import type { Quote } from "./mockQuote";
import { normalizeProductImageUrl } from "./normalizeProductImageUrl";
import { formatQuoteDiscountRate, isQuoteDiscountLine } from "./quoteDiscount";
import { formatShippingTotalLabel } from "./shippingMethod";
import { formatTaxRowLabel } from "./taxLabel";

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
  fgColor: { argb: "FFF3F4F6" },
};

const MONEY_FMT = '"$"#,##0.00';

function preferHighQualityImageUrl(url: string | null | undefined): string {
  return normalizeProductImageUrl(url) ?? url ?? "";
}

function applyBorderRange(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
) {
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
  url: string,
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
    try {
      const proxied = await fetch(
        `${apiBase}/quotes/image-proxy?url=${encodeURIComponent(url)}`,
      );
      if (!proxied.ok) return null;
      const data = (await proxied.json()) as { dataUrl?: string };
      const dataUrl = data.dataUrl ?? "";
      if (!dataUrl.startsWith("data:image/")) return null;
      const mime = dataUrl
        .slice("data:image/".length, dataUrl.indexOf(";"))
        .toLowerCase();
      const extension: "jpeg" | "png" | "gif" = mime.includes("png")
        ? "png"
        : mime.includes("gif")
          ? "gif"
          : "jpeg";
      const base64 = dataUrl.split(",")[1] ?? "";
      if (!base64) return null;
      return { base64, extension };
    } catch {
      return null;
    }
  }
}

async function loadLogoForExcel(): Promise<{
  base64: string;
  extension: "jpeg" | "png" | "gif";
} | null> {
  const candidates = [
    "/images/quote-logo.jpg",
    "/images/quote-logo.jpeg",
    "/images/quote-logo.png",
    "/images/logo.png",
    "/images/logo.jpg",
    "/images/logo.jpeg",
    "/logo.png",
  ];
  for (const src of candidates) {
    const loaded = await fetchImageForExcel(src);
    if (loaded) return loaded;
  }
  return null;
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
  // LOGO
  const logo = await loadLogoForExcel();
  const expoGoodsLogo = await fetchImageForExcel(
    "/images/quote-logo-expogoods.jpg",
  );
  if (logo) {
    const logoId = workbook.addImage({
      base64: logo.base64,
      extension: logo.extension,
    });
    ws.addImage(logoId, {
      // tl: { col: 0.03, row: 0.02 },
      tl: { col: 3.2, row: 0.02 },
      ext: { width: 118, height: 40 },
    });
    if (expoGoodsLogo) {
      const expoGoodsLogoId = workbook.addImage({
        base64: expoGoodsLogo.base64,
        extension: expoGoodsLogo.extension,
      });
      ws.addImage(expoGoodsLogoId, {
        tl: { col: 3.2, row: 2.3 },
        ext: { width: 118, height: 40 },
      });
    }
  } else {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = "xyzDisplays";
    ws.getCell(`A${row}`).font = { bold: true, size: 14 };
  }
  // QUOTE/DATE
  row += 5;
  ws.getCell(`D${row}`).value = "QUOTE";
  ws.getCell(`D${row}`).font = { bold: true };
  ws.getCell(`E${row}`).value = quote.quoteNumber;
  ws.getCell(`E${row}`).alignment = { horizontal: "right" };
  row += 1;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = "";
  ws.getCell(`D${row}`).value = "DATE";
  ws.getCell(`D${row}`).font = { bold: true };
  ws.getCell(`E${row}`).value = quote.quoteDate;
  ws.getCell(`E${row}`).alignment = { horizontal: "right" };
  applyBorderRange(ws, 6, 4, 7, 5);
  row += 1;

  // ADDRESS
  ws.getCell("A1").value = "170 Changebridge Rd, Bldg A7";
  ws.getCell("A2").value = "Montville, NJ 07045";
  ws.getCell("A3").value = "sales@xyzdisplays.com";
  ws.getCell("A4").value = "Phone: (973) 515-5151";

  // TO (must start below the QUOTE/DATE rows so merged gallery cells do not hide DATE)
  row = Math.max(row, 8);

  ws.getCell(`A${row}`).value = "TO";
  ws.getCell(`A${row}`).font = { bold: true };

  const toBlockStart = row;

  ws.mergeCells(`C${toBlockStart}:E${toBlockStart + 3}`);
  const galleryCell = ws.getCell(`C${toBlockStart}`);
  galleryCell.value = "Product images";
  galleryCell.alignment = {
    vertical: "top",
    horizontal: "center",
    wrapText: true,
  };

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

  // PRODUCT IMAGES
  const galleryItems = quote.items.filter((i) => Boolean(i.imageUrl?.trim()));
  const galleryUrls = galleryItems.map((i) =>
    preferHighQualityImageUrl(i.imageUrl),
  );

  const galleryResults = await Promise.all(
    galleryUrls.map((u) => (u ? fetchImageForExcel(u) : Promise.resolve(null))),
  );

  const perRow = 5;
  const startCol = 2.1;
  const colSpacing = 0.9;
  const startRow = toBlockStart + 0.12;
  const rowSpacing = 3.3;
  const imageWidth = 68;
  const imageHeight = 68;

  let embeddedGallery = 0;

  galleryUrls.forEach((url, i) => {
    if (!url) return;
    const img = galleryResults[i];
    if (!img) return;

    const colIndex = embeddedGallery % perRow;
    const rowIndex = Math.floor(embeddedGallery / perRow);

    const imageId = workbook.addImage({
      base64: img.base64,
      extension: img.extension,
    });

    ws.addImage(imageId, {
      tl: {
        col: startCol + colIndex * colSpacing,
        row: startRow + rowIndex * rowSpacing,
      },
      ext: {
        width: imageWidth,
        height: imageHeight,
      },
    });

    embeddedGallery += 1;
  });

  const anyGalleryUrl = galleryUrls.some(Boolean);
  const anyGalleryImage = galleryResults.some(
    (r, i) => galleryUrls[i] && r !== null,
  );
  if (anyGalleryUrl && !anyGalleryImage) {
    galleryCell.value = galleryUrls.filter(Boolean).join("\n");
  } else if (embeddedGallery > 0) {
    galleryCell.value = "";
  }

  const galleryRowCount = Math.max(1, Math.ceil(embeddedGallery / perRow));
  // Keep worksheet row indices as integers; image anchors can still use fractional rows.
  const galleryRowAdvance =
    1 + Math.max(0, Math.ceil((galleryRowCount - 1) * rowSpacing));
  row += galleryRowAdvance;

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
    r.getCell(2).alignment = {
      vertical: "top",
      horizontal: "left",
      wrapText: true,
      indent: 4,
    };
    r.getCell(3).value = isQuoteDiscountLine(item) ? "—" : item.qty;
    r.getCell(3).alignment = { horizontal: "center", vertical: "top" };
    if (isQuoteDiscountLine(item)) {
      r.getCell(4).value = formatQuoteDiscountRate(item);
      r.getCell(4).alignment = { horizontal: "right", vertical: "top" };
    } else {
      r.getCell(4).value = item.unitPrice;
      r.getCell(4).numFmt = MONEY_FMT;
      r.getCell(4).alignment = { horizontal: "right", vertical: "top" };
    }
    r.getCell(5).value = item.lineTotal;
    r.getCell(5).numFmt = MONEY_FMT;
    r.getCell(5).alignment = { horizontal: "right", vertical: "top" };
    // Keep description rows taller so text and thumbnail have enough breathing room.
    r.height = Math.max(52, Math.min(140, 22 + desc.split("\n").length * 18));

    const url = item.imageUrl?.trim()
      ? preferHighQualityImageUrl(item.imageUrl)
      : "";
    if (url) {
      const embedded = await fetchImageForExcel(url);
      if (embedded) {
        const imageId = workbook.addImage({
          base64: embedded.base64,
          extension: embedded.extension,
        });
        ws.addImage(imageId, {
          tl: { col: 1.04, row: row - 1 + 0.08 },
          ext: { width: 26, height: 26 },
        });
      }
    }
    row += 1;
  }

  const labelCol = 4;
  const valueCol = 5;

  const addTotalRow = (
    label: string,
    value: number,
    opts?: { bold?: boolean; thickTop?: boolean; textValue?: string | null },
  ) => {
    const rr = ws.getRow(row);
    rr.getCell(labelCol).value = label;
    rr.getCell(labelCol).alignment = { horizontal: "right" };
    if (opts?.textValue?.trim()) {
      rr.getCell(valueCol).value = opts.textValue.trim();
    } else {
      rr.getCell(valueCol).value = value;
      rr.getCell(valueCol).numFmt = MONEY_FMT;
    }
    rr.getCell(valueCol).alignment = { horizontal: "right" };
    if (opts?.bold) {
      rr.getCell(labelCol).font = { bold: true };
      rr.getCell(valueCol).font = { bold: true };
    }
    if (opts?.thickTop) {
      rr.getCell(labelCol).border = {
        top: { style: "medium", color: { argb: "FF6B7280" } },
      };
      rr.getCell(valueCol).border = {
        top: { style: "medium", color: { argb: "FF6B7280" } },
      };
    }
    row += 1;
  };

  addTotalRow("Subtotal", quote.subtotal);
  if (quote.discountTotal > 0) {
    addTotalRow("Discounts", -quote.discountTotal);
  }
  addTotalRow(formatShippingTotalLabel(quote), quote.shippingTotal, {
    textValue: quote.shippingLabel?.trim() || null,
  });
  addTotalRow(
    formatTaxRowLabel(quote.taxDescription, quote.shippingState),
    quote.taxTotal,
    {
      textValue: quote.taxLabel?.trim() || null,
    },
  );
  addTotalRow("TOTAL", quote.grandTotal, { bold: true, thickTop: true });

  row += 1;
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = "NOTES:";
  ws.getCell(`A${row}`).font = { bold: true };
  row += 1;
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = quote.notes ?? "";
  ws.getCell(`A${row}`).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = Math.max(
    40,
    20 + (quote.notes ?? "").split("\n").length * 16,
  );

  row += 1;
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = "Estimate Valid For 30 Days";
  ws.getCell(`A${row}`).alignment = { horizontal: "center" };
  ws.getCell(`A${row}`).font = { color: { argb: "FF6B7280" } };

  const lastUsedRow = row;
  const lastUsedCol = "E";

  // Print configuration: keep quote on a single A4 portrait page and avoid blank trailing pages.
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    verticalCentered: false,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.35,
      bottom: 0.35,
      header: 0.2,
      footer: 0.2,
    },
    printArea: `A1:${lastUsedCol}${lastUsedRow}`,
  };

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

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { getUploadsDir, resolveUploadedFilePath } from "../lib/uploadsDir";
import { recognizeImageText } from "../lib/ocrImageText";
import { guessAttachmentKind, isImageMimeType } from "../lib/quoteAttachments";

const router = Router();

const ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".pdf",
  ".txt",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".zip",
]);

function extensionFor(file: Express.Multer.File): string {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (ALLOWED_EXT.has(ext)) return ext;
  const mime = (file.mimetype || "").toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  if (mime.startsWith("image/")) return ".png";
  return "";
}

function isAllowedAttachment(file: Express.Multer.File): boolean {
  const mime = (file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (mime === "application/pdf" || ext === ".pdf") return true;
  if (mime === "text/plain" || ext === ".txt" || ext === ".csv") return true;
  if (ALLOWED_EXT.has(ext)) return true;
  return false;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadsDir());
  },
  filename: (_req, file, cb) => {
    const ext = extensionFor(file);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedAttachment(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("That file type is not allowed. Use images, PDF, or office documents."));
  },
});

function buildPublicFileUrl(req: Request, filename: string): string {
  const fromEnv = process.env.UPLOAD_PUBLIC_BASE_URL?.trim();
  const base = fromEnv
    ? fromEnv.replace(/\/$/, "")
    : `${req.protocol || "http"}://${req.get("host") ?? `localhost:${process.env.API_PORT ?? process.env.PORT ?? 5100}`}`;
  return `${base}/api/uploads/${encodeURIComponent(filename)}`;
}

router.post("/", (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    void (async () => {
      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const source = String(req.body?.source ?? "file").trim() === "paste" ? "paste" : "file";
      const mimeType = req.file.mimetype || "application/octet-stream";
      const fileName = (req.file.originalname || req.file.filename).trim();
      const kind = guessAttachmentKind(mimeType, fileName, source);
      let ocrText = "";
      if (isImageMimeType(mimeType)) {
        console.log("[ocr] reading text from", req.file.filename);
        ocrText = await recognizeImageText(req.file.path);
      }

      return res.json({
        url: buildPublicFileUrl(req, req.file.filename),
        fileName,
        mimeType,
        kind,
        sizeBytes: req.file.size,
        ocrText: ocrText || null,
      });
    })().catch(next);
  });
});

router.post("/ocr", (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const body = (req.body ?? {}) as { url?: string; fileName?: string };
    const target = String(body.url ?? body.fileName ?? "").trim();
    const filePath = resolveUploadedFilePath(target);
    if (!filePath) {
      return res.status(400).json({ error: "Image file was not found in uploads" });
    }
    const ocrText = await recognizeImageText(filePath);
    return res.json({ ocrText: ocrText || null });
  })().catch(next);
});

export default router;

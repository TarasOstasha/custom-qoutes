import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { getUploadsDir } from "../lib/uploadsDir";

const router = Router();
const uploadsDir = getUploadsDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

function buildPublicImageUrl(req: Request, filename: string): string {
  const fromEnv = process.env.UPLOAD_PUBLIC_BASE_URL?.trim();
  const base = fromEnv
    ? fromEnv.replace(/\/$/, "")
    : `${req.protocol || "http"}://${req.get("host") ?? `localhost:${process.env.PORT ?? 5000}`}`;
  return `${base}/api/uploads/${encodeURIComponent(filename)}`;
}

router.post("/", (req: Request, res: Response, next: NextFunction) => {
  upload.single("image")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      return res.status(400).json({ error: message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }
    const image_url = buildPublicImageUrl(req, req.file.filename);
    return res.json({ image_url });
  });
});

export default router;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const uploadsDir_1 = require("../lib/uploadsDir");
const router = (0, express_1.Router)();
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, (0, uploadsDir_1.getUploadsDir)());
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : ".jpg";
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only image files are allowed"));
        }
    },
});
function buildPublicImageUrl(req, filename) {
    const fromEnv = process.env.UPLOAD_PUBLIC_BASE_URL?.trim();
    const base = fromEnv
        ? fromEnv.replace(/\/$/, "")
        : `${req.protocol || "http"}://${req.get("host") ?? `localhost:${process.env.PORT ?? 5000}`}`;
    return `${base}/api/uploads/${encodeURIComponent(filename)}`;
}
router.post("/", (req, res, next) => {
    upload.single("image")(req, res, (err) => {
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
exports.default = router;

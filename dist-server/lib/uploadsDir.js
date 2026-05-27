"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUploadsDir = getUploadsDir;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function getUploadsDir() {
    const dir = process.env.UPLOADS_DIR?.trim() || path_1.default.join(process.cwd(), "uploads");
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

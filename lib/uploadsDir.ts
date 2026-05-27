import fs from "fs";
import path from "path";

export function getUploadsDir(): string {
  const dir = process.env.UPLOADS_DIR?.trim() || path.join(process.cwd(), "uploads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

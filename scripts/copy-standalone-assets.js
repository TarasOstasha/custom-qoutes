/**
 * Next.js standalone output does not include static assets or public files.
 * Copy them into .next/standalone so the standalone server can serve /_next/static.
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/output#automatically-copying-required-files
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(root, "public");
const publicDest = path.join(standaloneDir, "public");

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`copy-standalone-assets: missing ${label}: ${filePath}`);
    console.error('Run "npm run build" first.');
    process.exit(1);
  }
}

mustExist(standaloneDir, "standalone output");
mustExist(staticSrc, ".next/static");

fs.mkdirSync(path.dirname(staticDest), { recursive: true });
fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
console.log(`Copied .next/static -> .next/standalone/.next/static`);

if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
  console.log(`Copied public -> .next/standalone/public`);
} else {
  console.log("No public/ folder; skipped public copy.");
}

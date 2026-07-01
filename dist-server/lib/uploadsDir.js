"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUploadsDir = getUploadsDir;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const resolveDatabaseUrl_1 = require("./resolveDatabaseUrl");
function localUploadsDir() {
    return path_1.default.join(process.cwd(), "uploads");
}
function isUncPath(dir) {
    return dir.startsWith("\\\\") || dir.startsWith("//");
}
function isLanPrivateHost(host) {
    return (host.startsWith("192.168.") ||
        host.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host));
}
function shouldUseLocalUploadsForRemoteDb(configured) {
    if (process.env.UPLOADS_DIR_FORCE?.trim().toLowerCase() === "true") {
        return false;
    }
    const dbHost = (0, resolveDatabaseUrl_1.getHostFromPostgresUrl)(process.env.DATABASE_URL?.trim() ?? "");
    if (!dbHost || !isUncPath(configured)) {
        return false;
    }
    return !isLanPrivateHost(dbHost);
}
function ensureLocalDir(dir) {
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function ensureUncDir(dir) {
    // Avoid fs.existsSync on UNC paths — it can block for a long time on Windows.
    try {
        fs_1.default.mkdirSync(dir, { recursive: true });
        return dir;
    }
    catch (error) {
        throw error;
    }
}
function ensureDir(dir) {
    if (isUncPath(dir)) {
        return ensureUncDir(dir);
    }
    return ensureLocalDir(dir);
}
function getUploadsDir() {
    const configured = process.env.UPLOADS_DIR?.trim();
    const fallback = localUploadsDir();
    if (!configured) {
        return ensureLocalDir(fallback);
    }
    if (shouldUseLocalUploadsForRemoteDb(configured)) {
        console.info(`Using local uploads (${fallback}) — UPLOADS_DIR is a LAN share but DATABASE_URL uses Tailscale.`);
        return ensureLocalDir(fallback);
    }
    try {
        return ensureDir(configured);
    }
    catch (error) {
        console.warn(`UPLOADS_DIR is unreachable (${configured}); using local folder ${fallback}.`, error instanceof Error ? error.message : error);
        return ensureLocalDir(fallback);
    }
}

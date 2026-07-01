"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFLINE_PERSISTENCE_MESSAGE = void 0;
exports.probeOfficePersistence = probeOfficePersistence;
exports.isOfficePersistenceAvailable = isOfficePersistenceAvailable;
exports.getCachedOfficePersistenceAvailable = getCachedOfficePersistenceAvailable;
exports.refreshOfficePersistenceStatus = refreshOfficePersistenceStatus;
const models_1 = require("./models");
const CHECK_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30000;
const FAILURE_CACHE_TTL_MS = 5000;
let cachedAvailable = null;
let cachedAt = 0;
function usesLocalSqlite() {
    const url = process.env.DATABASE_URL?.trim() ?? "";
    return url.startsWith("sqlite:");
}
function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Office persistence check timed out")), ms);
        promise
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
async function probeOfficePersistence() {
    if (usesLocalSqlite()) {
        return true;
    }
    try {
        await withTimeout((0, models_1.getActiveSequelize)().authenticate(), CHECK_TIMEOUT_MS);
        return true;
    }
    catch {
        return false;
    }
}
async function isOfficePersistenceAvailable(forceRefresh = false) {
    const now = Date.now();
    const cacheTtl = cachedAvailable ? CACHE_TTL_MS : FAILURE_CACHE_TTL_MS;
    if (!forceRefresh && cachedAvailable !== null && now - cachedAt < cacheTtl) {
        return cachedAvailable;
    }
    cachedAvailable = await probeOfficePersistence();
    cachedAt = now;
    return cachedAvailable;
}
function getCachedOfficePersistenceAvailable() {
    return cachedAvailable;
}
async function refreshOfficePersistenceStatus() {
    return isOfficePersistenceAvailable(true);
}
exports.OFFLINE_PERSISTENCE_MESSAGE = "Quote was not saved — database is unavailable. Connect Tailscale and restart the app.";

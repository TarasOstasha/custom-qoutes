"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshDatabaseConnection = refreshDatabaseConnection;
const resolveDatabaseUrl_1 = require("./resolveDatabaseUrl");
const sequelize_1 = require("../db/sequelize");
async function refreshDatabaseConnection() {
    await (0, resolveDatabaseUrl_1.resolveDatabaseUrl)();
    const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
    if (!databaseUrl || databaseUrl.startsWith("sqlite:")) {
        try {
            await (0, sequelize_1.getActiveSequelize)().authenticate();
            return true;
        }
        catch {
            return false;
        }
    }
    try {
        return await (0, sequelize_1.reconnectSequelize)();
    }
    catch (error) {
        console.error("Failed to refresh database connection:", error);
        return false;
    }
}

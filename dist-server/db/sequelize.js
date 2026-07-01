"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveSequelize = getActiveSequelize;
exports.reconnectSequelize = reconnectSequelize;
const sequelize_1 = require("sequelize");
if (process.env.NODE_ENV !== "production") {
    try {
        require("dotenv").config({ quiet: true });
    }
    catch { }
}
function createSequelize(databaseUrl) {
    const isSqlite = databaseUrl.startsWith("sqlite:");
    const sqliteStorage = isSqlite ? databaseUrl.replace(/^sqlite:/, "") : "";
    if (isSqlite) {
        try {
            require.resolve("sqlite3");
        }
        catch {
            throw new Error("DATABASE_URL uses sqlite, but sqlite3 is not installed. Install sqlite3 or set a PostgreSQL DATABASE_URL.");
        }
        return new sequelize_1.Sequelize({
            dialect: "sqlite",
            storage: sqliteStorage,
            logging: false,
        });
    }
    return new sequelize_1.Sequelize(databaseUrl, {
        dialect: "postgres",
        logging: false,
    });
}
function requireDatabaseUrl() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        throw new Error("DATABASE_URL is required to initialize Sequelize.");
    }
    return databaseUrl;
}
let activeSequelize = createSequelize(requireDatabaseUrl());
function getActiveSequelize() {
    return activeSequelize;
}
async function reconnectSequelize() {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) {
        return false;
    }
    try {
        await activeSequelize.close();
    }
    catch {
        /* ignore */
    }
    activeSequelize = createSequelize(databaseUrl);
    const { Quote } = require("../lib/models/Quote");
    const { QuoteItem } = require("../lib/models/QuoteItem");
    Quote.sequelize = activeSequelize;
    QuoteItem.sequelize = activeSequelize;
    await activeSequelize.authenticate();
    return true;
}
exports.default = activeSequelize;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sequelize = void 0;
const sequelize_1 = require("sequelize");
if (process.env.NODE_ENV !== "production") {
    try {
        require("dotenv").config({ quiet: true });
    }
    catch { }
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to initialize Sequelize.");
}
const isSqlite = databaseUrl.startsWith("sqlite:");
const sqliteStorage = isSqlite ? databaseUrl.replace(/^sqlite:/, "") : "";
if (isSqlite) {
    try {
        require.resolve("sqlite3");
    }
    catch {
        throw new Error("DATABASE_URL uses sqlite, but sqlite3 is not installed. Install sqlite3 or set a PostgreSQL DATABASE_URL.");
    }
}
const sequelize = isSqlite
    ? new sequelize_1.Sequelize({
        dialect: "sqlite",
        storage: sqliteStorage,
        logging: false,
    })
    : new sequelize_1.Sequelize(databaseUrl, {
        dialect: "postgres",
        logging: false,
    });
exports.sequelize = sequelize;
exports.default = sequelize;

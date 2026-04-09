"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiBase = void 0;
const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
/** Base URL for the Express API (no trailing slash). */
exports.apiBase = raw.replace(/\/$/, "");

const raw = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

/** Base URL for the Express API (no trailing slash). */
export const apiBase = raw.replace(/\/$/, "");

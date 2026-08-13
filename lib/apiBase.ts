declare global {
  interface Window {
    customQuote?: {
      apiBase?: string;
    };
  }
}

const DEFAULT_API_URL = "http://localhost:5100";

/** Base URL for the Express API (no trailing slash). Resolved at call time so Electron can pick a free port. */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const fromElectron = window.customQuote?.apiBase;
    if (typeof fromElectron === "string" && fromElectron.trim() !== "") {
      return fromElectron.replace(/\/$/, "");
    }
  }

  const raw = process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  return raw.replace(/\/$/, "");
}

/** Same as getApiBase(); kept for existing imports. */
export const apiBase = {
  toString: getApiBase,
  valueOf: getApiBase,
  [Symbol.toPrimitive]: getApiBase,
} as unknown as string;

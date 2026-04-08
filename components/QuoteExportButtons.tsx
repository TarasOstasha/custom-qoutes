"use client";

import type { CSSProperties } from "react";
import { exportQuoteToExcel } from "../lib/exportQuoteToExcel";
import { exportQuoteToPdf } from "../lib/exportQuoteToPdf";
import type { Quote } from "../lib/mockQuote";

type Props = {
  quote: Quote;
  colored?: boolean;
};

function iconButtonStyle(baseColor?: string): CSSProperties | undefined {
  if (!baseColor) return undefined;
  return {
    backgroundColor: baseColor,
    color: "white",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
}

export default function QuoteExportButtons({ quote, colored = false }: Props) {
  return (
    <>
      <button
        type="button"
        className="btn"
        style={iconButtonStyle(colored ? "green" : undefined)}
        onClick={() => void exportQuoteToExcel(quote)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M14 2v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 16l6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M15 16l-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>Export Excel</span>
      </button>
      <button
        type="button"
        className="btn"
        style={iconButtonStyle(colored ? "red" : undefined)}
        onClick={() => void exportQuoteToPdf(quote)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M14 2v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d="M8 17v-5h2.2a1.7 1.7 0 0 1 0 3.4H8m6-3.4h-2v5h2a1.8 1.8 0 0 0 0-5m3 5v-5h1.4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Export PDF</span>
      </button>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import calculator from "advanced-calculator";

type Props = {
  onClose: () => void;
};

type CalcKey = {
  label: string;
  insert?: string;
  action?: "clear" | "backspace" | "equals" | "percent" | "sign";
  variant?: "fn" | "op" | "eq" | "danger";
  span?: 2 | 4;
  ariaLabel?: string;
};

const KEYS: CalcKey[] = [
  { label: "C", action: "clear", variant: "danger", ariaLabel: "Clear" },
  { label: "⌫", action: "backspace", variant: "fn", ariaLabel: "Backspace" },
  { label: "(", insert: "(" },
  { label: ")", insert: ")" },
  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "÷", insert: "/", variant: "op", ariaLabel: "Divide" },
  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "×", insert: "*", variant: "op", ariaLabel: "Multiply" },
  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: "−", insert: "-", variant: "op", ariaLabel: "Subtract" },
  { label: "0", insert: "0" },
  { label: ".", insert: "." },
  { label: "%", action: "percent", variant: "fn", ariaLabel: "Percent" },
  { label: "+", insert: "+", variant: "op", ariaLabel: "Add" },
  { label: "√", insert: "sqrt(", variant: "fn", ariaLabel: "Square root" },
  { label: "^", insert: "^", variant: "fn", ariaLabel: "Power" },
  { label: "π", insert: "pi", variant: "fn", ariaLabel: "Pi" },
  { label: "±", action: "sign", variant: "fn", ariaLabel: "Toggle sign" },
  { label: "=", action: "equals", variant: "eq", span: 4, ariaLabel: "Equals" },
];

function formatCalculatorNumber(value: number): string {
  if (!Number.isFinite(value)) return "Invalid input";
  if (Object.is(value, -0)) return "0";
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}

function applyPercent(expression: string): string {
  const match = expression.match(/(\d+\.?\d*)$/);
  if (!match || match[1] == null) return expression;
  const num = match[1];
  return `${expression.slice(0, -num.length)}(${num}/100)`;
}

function toggleSign(expression: string): string {
  if (!expression) return "-";
  const match = expression.match(/^(.*?)(-?\d+\.?\d*)$/);
  if (!match || match[2] == null) {
    if (expression.startsWith("-(") && expression.endsWith(")")) {
      return expression.slice(2, -1);
    }
    return `-(${expression})`;
  }
  const prefix = match[1] ?? "";
  const num = match[2];
  if (num.startsWith("-")) return prefix + num.slice(1);
  if (prefix.endsWith("(") || prefix === "") return `${prefix}-${num.replace(/^-/, "")}`;
  return `${prefix}(-${num})`;
}

function evaluateExpression(expression: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = expression.trim();
  if (!trimmed) return { ok: false, error: "Enter an expression" };
  try {
    const result = calculator.evaluate(trimmed);
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return { ok: false, error: "Invalid input" };
    }
    return { ok: true, value: formatCalculatorNumber(result) };
  } catch {
    return { ok: false, error: "Invalid input" };
  }
}

export default function QuoteCalculator({ onClose }: Props) {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runEquals = (source = expression) => {
    const evaluated = evaluateExpression(source);
    if (!evaluated.ok) {
      setResult(null);
      setError(evaluated.error);
      setJustEvaluated(false);
      return;
    }
    setError(null);
    setResult(evaluated.value);
    setJustEvaluated(true);
  };

  const insertToken = (token: string) => {
    setError(null);
    setCopied(false);
    const continueFromResult = justEvaluated && result != null && /^[+\-*/%^]/.test(token);
    const startFresh = justEvaluated && result != null && !/^[+\-*/%^]/.test(token);
    setExpression((prev) => {
      if (continueFromResult) return `${result}${token}`;
      if (startFresh) return token;
      return `${prev}${token}`;
    });
    setJustEvaluated(false);
    setResult(null);
  };

  const handleKey = (key: CalcKey) => {
    if (key.insert != null) {
      insertToken(key.insert);
      return;
    }
    if (key.action === "clear") {
      setExpression("");
      setResult(null);
      setError(null);
      setJustEvaluated(false);
      setCopied(false);
      inputRef.current?.focus();
      return;
    }
    if (key.action === "backspace") {
      setError(null);
      setCopied(false);
      if (justEvaluated) {
        setJustEvaluated(false);
        setResult(null);
      }
      setExpression((prev) => prev.slice(0, -1));
      return;
    }
    if (key.action === "percent") {
      setError(null);
      setCopied(false);
      setJustEvaluated(false);
      setResult(null);
      setExpression((prev) => applyPercent(prev));
      return;
    }
    if (key.action === "sign") {
      setError(null);
      setCopied(false);
      setJustEvaluated(false);
      setResult(null);
      setExpression((prev) => toggleSign(prev));
      return;
    }
    if (key.action === "equals") {
      runEquals();
    }
  };

  const copyResult = async () => {
    if (result == null) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="quote-calculator" aria-label="Calculator">
      <div className="quote-calculator-header">
        <h2 className="quote-calculator-title">Calculator</h2>
        <button type="button" className="quote-calculator-close" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="quote-calculator-label" htmlFor="quote-calculator-expression">
        Expression
      </label>
      <input
        id="quote-calculator-expression"
        ref={inputRef}
        className="quote-calculator-input"
        value={expression}
        onChange={(e) => {
          setExpression(e.target.value);
          setJustEvaluated(false);
          setResult(null);
          setError(null);
          setCopied(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            runEquals(e.currentTarget.value);
          }
        }}
        placeholder="e.g. 12.5 * 4 + 8.25"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="quote-calculator-result" aria-live="polite">
        {error ? (
          <span className="quote-calculator-error">{error}</span>
        ) : result != null ? (
          <span>
            = {result}
            <button type="button" className="quote-calculator-copy" onClick={() => void copyResult()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        ) : (
          <span className="muted">Press = to calculate</span>
        )}
      </div>
      <div className="quote-calculator-keys">
        {KEYS.map((key) => (
          <button
            key={`${key.label}-${key.insert ?? key.action}`}
            type="button"
            className={[
              "quote-calculator-key",
              key.variant ? `quote-calculator-key-${key.variant}` : "",
              key.span ? `quote-calculator-key-span-${key.span}` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => handleKey(key)}
            aria-label={key.ariaLabel ?? key.label}
          >
            {key.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

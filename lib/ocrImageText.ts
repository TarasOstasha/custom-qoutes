import path from "path";
import fs from "fs";

const OCR_TIMEOUT_MS = 120_000;
const OCR_MAX_CHARS = 12_000;

type TesseractModule = typeof import("tesseract.js");

let workerPromise: Promise<import("tesseract.js").Worker> | null = null;
let jobQueue: Promise<unknown> = Promise.resolve();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OCR timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function getWorker(): Promise<import("tesseract.js").Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract: TesseractModule = await import("tesseract.js");
      const worker = await tesseract.createWorker("eng");
      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function recognizeOnce(filePath: string, psm: string): Promise<string> {
  const tesseract: TesseractModule = await import("tesseract.js");
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm as never });
  const result = await worker.recognize(filePath);
  return (result.data?.text ?? "").replace(/\s+/g, " ").trim().slice(0, OCR_MAX_CHARS);
}

function compactAlpha(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mergeOcrTexts(parts: string[]): string {
  const seen = new Set<string>();
  const chunks: string[] = [];
  for (const part of parts) {
    const text = part.replace(/\s+/g, " ").trim();
    const compact = compactAlpha(text);
    if (!text || !compact || seen.has(compact)) continue;
    if ([...seen].some((existing) => existing.includes(compact) && existing.length > compact.length + 6)) {
      continue;
    }
    seen.add(compact);
    chunks.push(text);
  }
  return chunks.join(" ").slice(0, OCR_MAX_CHARS);
}

async function recognizeWithTesseract(filePath: string): Promise<string> {
  const tesseract: TesseractModule = await import("tesseract.js");
  const modes = [tesseract.PSM.SPARSE_TEXT, tesseract.PSM.SINGLE_COLUMN, tesseract.PSM.AUTO];
  const parts: string[] = [];
  for (const mode of modes) {
    parts.push(await recognizeOnce(filePath, mode));
  }
  return mergeOcrTexts(parts);
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = jobQueue.then(work, work);
  jobQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Best-effort OCR for screenshots/images so quote search can match text in the picture. */
export async function recognizeImageText(filePath: string): Promise<string> {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const text = await enqueue(() => withTimeout(recognizeWithTesseract(filePath), OCR_TIMEOUT_MS));
    console.log("[ocr] extracted", path.basename(filePath), text ? `${text.slice(0, 180)}…` : "(empty)");
    return text;
  } catch (error) {
    console.warn(
      "[ocr] screenshot text extraction skipped:",
      error instanceof Error ? error.message : error,
    );
    return "";
  }
}

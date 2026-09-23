"use client";

import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/apiBase";
import {
  formatAttachmentSize,
  guessAttachmentKind,
  refreshAttachmentSearchText,
  screenshotFileName,
  type QuoteInternalAttachment,
} from "../lib/quoteAttachments";

type Props = {
  attachments: QuoteInternalAttachment[];
  onChange: (next: QuoteInternalAttachment[]) => void;
};

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.44 11.05l-8.49 8.49a6 6 0 0 1-8.49-8.49l8.85-8.85a4 4 0 0 1 5.66 5.66l-8.85 8.85a2 2 0 1 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function newAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function QuoteInternalAttachments({ attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanningIds, setScanningIds] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const scanningRef = useRef<Set<string>>(new Set());
  const attemptedScanRef = useRef<Set<string>>(new Set());

  const uploadFiles = async (files: File[], source: "file" | "paste") => {
    const list = Array.from(files).filter(Boolean);
    if (!list.length) return;

    setUploading(true);
    setError(null);
    const uploaded: QuoteInternalAttachment[] = [];

    try {
      for (const file of list) {
        const formData = new FormData();
        const named =
          source === "paste" && (!file.name || file.name === "image.png")
            ? new File([file], screenshotFileName(file.type), { type: file.type || "image/png" })
            : file;
        formData.append("file", named);
        formData.append("source", source);

        const response = await fetch(`${getApiBase()}/api/upload-attachment`, {
          method: "POST",
          body: formData,
        });
        const data = (await response.json()) as {
          url?: string;
          fileName?: string;
          mimeType?: string;
          kind?: QuoteInternalAttachment["kind"];
          sizeBytes?: number;
          ocrText?: string | null;
          error?: string;
        };
        if (!response.ok || !data.url) {
          throw new Error(data.error ?? `Failed to upload ${named.name}`);
        }

        uploaded.push(
          refreshAttachmentSearchText({
            id: newAttachmentId(),
            fileName: (data.fileName || named.name).trim(),
            mimeType: data.mimeType || named.type || "application/octet-stream",
            url: data.url,
            kind: data.kind || guessAttachmentKind(named.type, named.name, source),
            caption: null,
            ocrText: data.ocrText ?? null,
            searchText: "",
            sizeBytes: data.sizeBytes ?? named.size,
            createdAt: new Date().toISOString(),
          }),
        );
      }

      if (uploaded.length) {
        onChange([...attachmentsRef.current, ...uploaded]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const applyOcrText = (id: string, ocrText: string | null) => {
    const next = attachmentsRef.current.map((attachment) =>
      attachment.id === id
        ? refreshAttachmentSearchText({ ...attachment, ocrText: ocrText?.trim() || null })
        : attachment,
    );
    attachmentsRef.current = next;
    onChange(next);
  };

  const scanAttachment = async (attachment: QuoteInternalAttachment) => {
    if (attachment.kind === "file" || scanningRef.current.has(attachment.id)) return;
    scanningRef.current.add(attachment.id);
    attemptedScanRef.current.add(attachment.id);
    setScanningIds((prev) => ({ ...prev, [attachment.id]: true }));
    try {
      const response = await fetch(`${getApiBase()}/api/upload-attachment/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: attachment.url }),
      });
      const data = (await response.json()) as { ocrText?: string | null; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not read text from image");
      }
      applyOcrText(attachment.id, data.ocrText ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read text from image");
    } finally {
      scanningRef.current.delete(attachment.id);
      setScanningIds((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    }
  };

  useEffect(() => {
    for (const attachment of attachments) {
      if (attachment.kind === "file") continue;
      if (attachment.ocrText && attachment.searchCompact) continue;
      if (attemptedScanRef.current.has(attachment.id) || scanningRef.current.has(attachment.id)) continue;
      void scanAttachment(attachment);
    }
  }, [attachments]);

  const uploadFilesRef = useRef(uploadFiles);
  uploadFilesRef.current = uploadFiles;

  const collectClipboardFiles = (clipboardData: DataTransfer | null): File[] => {
    if (!clipboardData) return [];
    const fromItems: File[] = [];
    for (const item of Array.from(clipboardData.items ?? [])) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) fromItems.push(file);
      }
    }
    if (fromItems.length) return fromItems;
    return Array.from(clipboardData.files ?? []);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = collectClipboardFiles(event.clipboardData);
      if (!files.length) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField = tag === "input" || tag === "textarea" || Boolean(target?.isContentEditable);
      const inDropzone = Boolean(dropRef.current && target && dropRef.current.contains(target));
      if (inField && !inDropzone) return;

      event.preventDefault();
      void uploadFilesRef.current(files, "paste");
    };

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const updateCaption = (id: string, caption: string) => {
    onChange(
      attachments.map((attachment) =>
        attachment.id === id
          ? refreshAttachmentSearchText({ ...attachment, caption })
          : attachment,
      ),
    );
  };

  const removeAttachment = (id: string) => {
    onChange(attachments.filter((attachment) => attachment.id !== id));
  };

  return (
    <div className="quote-internal-attachments" style={{ marginTop: 14 }}>
      <label htmlFor="quote-internal-attachments-input">Internal attachments</label>
      <div className="muted" style={{ fontSize: 12, margin: "0 0 8px", lineHeight: 1.4 }}>
        Files, images, and screenshots stay in the builder only — they are not added to PDF or Excel
        export. Search finds PDF names and text inside screenshots.
      </div>
      <div
        ref={dropRef}
        className={`quote-internal-dropzone${dragOver ? " is-dragover" : ""}`}
        tabIndex={0}
        role="group"
        aria-label="Internal attachments dropzone. Paste a screenshot or drop files here."
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadFiles(Array.from(event.dataTransfer.files ?? []), "file");
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <input
          ref={inputRef}
          id="quote-internal-attachments-input"
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(files, "file");
          }}
        />
        <div className="quote-internal-dropzone-copy">
          {uploading ? "Uploading and reading text from images…" : "Drop files here or paste a screenshot"}
        </div>
        <div className="quote-internal-dropzone-actions">
          <button
            type="button"
            className="btn"
            onClick={(event) => {
              event.stopPropagation();
              inputRef.current?.click();
            }}
            disabled={uploading}
          >
            <PaperclipIcon />
            <span>Attach files</span>
          </button>
        </div>
      </div>
      {error ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>{error}</div>
      ) : null}
      {attachments.length > 0 ? (
        <ul className="quote-internal-attachment-list">
          {attachments.map((attachment) => {
            const isVisual = attachment.kind !== "file";
            const sizeLabel = formatAttachmentSize(attachment.sizeBytes);
            return (
              <li key={attachment.id} className="quote-internal-attachment-row">
                {isVisual ? (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="quote-internal-thumb-link"
                    title={attachment.fileName}
                  >
                    <img src={attachment.url} alt={attachment.fileName} />
                  </a>
                ) : (
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="quote-internal-file-icon"
                    title={attachment.fileName}
                  >
                    <FileIcon />
                  </a>
                )}
                <div className="quote-internal-attachment-meta">
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="quote-internal-file-name"
                    title={attachment.fileName}
                  >
                    {attachment.fileName}
                  </a>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {[attachment.kind === "screenshot" ? "Screenshot" : attachment.kind === "image" ? "Image" : "File", sizeLabel]
                      .filter(Boolean)
                      .join(" · ")}
                    {scanningIds[attachment.id]
                      ? " · reading text…"
                      : attachment.ocrText
                        ? " · searchable from picture text"
                        : isVisual
                          ? " · no text found yet"
                          : ""}
                  </div>
                  {attachment.ocrText ? (
                    <div
                      className="muted quote-internal-ocr-preview"
                      title={attachment.ocrText}
                    >
                      {attachment.ocrText}
                    </div>
                  ) : null}
                  {isVisual ? (
                    <button
                      type="button"
                      className="btn"
                      style={{ marginTop: 6, padding: "6px 10px", fontSize: 12 }}
                      disabled={Boolean(scanningIds[attachment.id])}
                      onClick={(event) => {
                        event.stopPropagation();
                        attemptedScanRef.current.delete(attachment.id);
                        void scanAttachment(attachment);
                      }}
                    >
                      {scanningIds[attachment.id] ? "Reading text…" : "Re-scan text"}
                    </button>
                  ) : null}
                  <input
                    type="text"
                    value={attachment.caption ?? ""}
                    onChange={(event) => updateCaption(attachment.id, event.target.value)}
                    onBlur={(event) =>
                      updateCaption(attachment.id, event.target.value.trim())
                    }
                    placeholder="Optional note (searchable)"
                    aria-label={`Note for ${attachment.fileName}`}
                    className="quote-internal-caption"
                  />
                </div>
                <button
                  type="button"
                  className="quote-image-remove-btn"
                  aria-label={`Remove ${attachment.fileName}`}
                  title="Remove attachment"
                  onClick={() => removeAttachment(attachment.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

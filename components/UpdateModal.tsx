"use client";

import type { UpdaterSnapshot } from "../lib/electronUpdater";

type Props = {
  open: boolean;
  state: UpdaterSnapshot;
  onClose: () => void;
  onDownload: () => void;
  onRemindLater: () => void;
  onRestartNow: () => void;
  onRestartLater: () => void;
};

export default function UpdateModal({
  open,
  state,
  onClose,
  onDownload,
  onRemindLater,
  onRestartNow,
  onRestartLater,
}: Props) {
  if (!open) {
    return null;
  }

  const isDownloading = state.status === "downloading";
  const isDownloaded = state.status === "downloaded";

  return (
    <div className="update-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="update-modal"
        role="dialog"
        aria-labelledby="update-modal-title"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="update-modal-title" className="update-modal-title">
          {isDownloaded ? "Update Ready" : "Update Available"}
        </h2>

        <p className="update-modal-copy">
          {isDownloaded
            ? "A new version has been downloaded and is ready to install."
            : "A newer version of Custom Quote is available."}
        </p>

        <dl className="update-modal-versions">
          <div>
            <dt>Current version</dt>
            <dd>{state.currentVersion || "—"}</dd>
          </div>
          <div>
            <dt>New version</dt>
            <dd>{state.newVersion || "—"}</dd>
          </div>
        </dl>

        {isDownloading ? (
          <div className="update-modal-progress">
            <div className="update-modal-progress-label">
              Downloading… {state.percent}%
            </div>
            <div className="update-modal-progress-track" aria-hidden="true">
              <div
                className="update-modal-progress-bar"
                style={{ width: `${Math.max(0, Math.min(100, state.percent))}%` }}
              />
            </div>
          </div>
        ) : null}

        {state.status === "error" && state.error ? (
          <p className="update-modal-error" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="update-modal-actions">
          {isDownloaded ? (
            <>
              <button type="button" className="btn" onClick={onRestartLater}>
                Later
              </button>
              <button type="button" className="btn primary" onClick={onRestartNow}>
                Restart Now
              </button>
            </>
          ) : isDownloading ? (
            <button type="button" className="btn" onClick={onClose}>
              Hide
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onRemindLater}>
                Remind Me Later
              </button>
              <button type="button" className="btn primary" onClick={onDownload}>
                Download Update
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

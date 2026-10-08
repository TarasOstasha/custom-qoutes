"use client";

import { useEffect, useMemo, useState } from "react";
import { version as packageVersion } from "../package.json";
import { compareVersions } from "../lib/versionCompare";
import { useAppUpdater } from "./ElectronUpdaterBridge";

export default function AppHeader() {
  const {
    updateAvailable,
    openModal,
    state,
    availableVersions,
    listVersions,
    installVersion,
  } = useAppUpdater();
  const currentVersion = state.currentVersion || packageVersion;
  const [selectedVersion, setSelectedVersion] = useState(currentVersion);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    setSelectedVersion(currentVersion);
  }, [currentVersion]);

  useEffect(() => {
    void listVersions();
  }, [listVersions]);

  const versions = useMemo(() => {
    const merged = new Set<string>([
      currentVersion,
      ...availableVersions,
      ...(state.availableVersions || []),
    ]);
    return Array.from(merged).sort(compareVersions).reverse();
  }, [availableVersions, currentVersion, state.availableVersions]);

  const isPreviousVersion =
    Boolean(selectedVersion) &&
    compareVersions(selectedVersion, currentVersion) < 0;

  const onRevert = async () => {
    if (!isPreviousVersion || reverting) {
      return;
    }

    setReverting(true);
    try {
      await installVersion(selectedVersion);
    } finally {
      setReverting(false);
    }
  };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-title">
          Custom Quote
          <label className="app-header-version-picker">
            <span className="sr-only">App version</span>
            <select
              className="app-header-version-select"
              value={selectedVersion}
              onChange={(event) => setSelectedVersion(event.target.value)}
              aria-label="Select app version"
            >
              {versions.map((version) => (
                <option key={version} value={version}>
                  v{version}
                  {version === currentVersion ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
          {isPreviousVersion ? (
            <button
              type="button"
              className="revert-badge"
              onClick={() => void onRevert()}
              disabled={reverting || state.status === "downloading"}
            >
              {reverting || state.status === "downloading"
                ? "Reverting…"
                : `Revert back to v${selectedVersion}`}
            </button>
          ) : null}
        </div>
        {updateAvailable ? (
          <button
            type="button"
            className="update-badge"
            onClick={openModal}
            aria-label="Open update details"
          >
            🔔 Update Available
          </button>
        ) : null}
      </div>
    </header>
  );
}

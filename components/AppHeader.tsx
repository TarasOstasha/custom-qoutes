"use client";

import { useAppUpdater } from "./ElectronUpdaterBridge";

export default function AppHeader() {
  const { updateAvailable, openModal } = useAppUpdater();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-header-title">Custom Quote</div>
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

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdaterSnapshot = {
  status: UpdaterStatus;
  currentVersion: string;
  newVersion: string | null;
  percent: number;
  error: string | null;
  dismissed: boolean;
};

export type ElectronUpdaterApi = {
  getState: () => Promise<UpdaterSnapshot>;
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
  quitAndInstall: () => Promise<void>;
  remindLater: () => Promise<void>;
  onStatus: (callback: (state: UpdaterSnapshot) => void) => () => void;
};

declare global {
  interface Window {
    electronUpdater?: ElectronUpdaterApi;
  }
}

export function getElectronUpdaterApi(): ElectronUpdaterApi | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.electronUpdater ?? null;
}

export function isElectronApp(): boolean {
  return getElectronUpdaterApi() !== null;
}

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export type InstallMode = "update" | "revert";

export type UpdaterSnapshot = {
  status: UpdaterStatus;
  currentVersion: string;
  newVersion: string | null;
  targetVersion?: string | null;
  installMode?: InstallMode | null;
  availableVersions?: string[];
  percent: number;
  error: string | null;
  dismissed: boolean;
};

export type ElectronUpdaterApi = {
  getState: () => Promise<UpdaterSnapshot>;
  listVersions: () => Promise<{
    ok: boolean;
    versions: string[];
    currentVersion?: string;
    error?: string;
  }>;
  installVersion: (
    version: string,
  ) => Promise<{ ok: boolean; error?: string }>;
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

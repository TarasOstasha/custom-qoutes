"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getElectronUpdaterApi,
  type UpdaterSnapshot,
} from "../lib/electronUpdater";
import { compareVersions } from "../lib/versionCompare";
import UpdateModal from "./UpdateModal";

const idleState: UpdaterSnapshot = {
  status: "idle",
  currentVersion: "",
  newVersion: null,
  targetVersion: null,
  installMode: null,
  availableVersions: [],
  percent: 0,
  error: null,
  dismissed: false,
};

type UpdaterContextValue = {
  state: UpdaterSnapshot;
  updateAvailable: boolean;
  availableVersions: string[];
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  listVersions: () => Promise<string[]>;
  installVersion: (version: string) => Promise<{ ok: boolean; error?: string }>;
};

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function useAppUpdater(): UpdaterContextValue {
  const context = useContext(UpdaterContext);
  if (!context) {
    return {
      state: idleState,
      updateAvailable: false,
      availableVersions: [],
      modalOpen: false,
      openModal: () => undefined,
      closeModal: () => undefined,
      listVersions: async () => [],
      installVersion: async () => ({
        ok: false,
        error: "Version install is only available in the desktop app",
      }),
    };
  }
  return context;
}

export default function ElectronUpdaterBridge({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<UpdaterSnapshot>(idleState);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const api = getElectronUpdaterApi();
    if (!api) {
      return;
    }

    let active = true;

    void api.getState().then((initial) => {
      if (active) {
        setState(initial);
      }
    });

    const unsubscribe = api.onStatus((next) => {
      if (active) {
        setState(next);
        if (
          next.installMode === "revert" &&
          (next.status === "downloading" ||
            next.status === "downloaded" ||
            next.status === "error")
        ) {
          setModalOpen(true);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const listVersions = useCallback(async () => {
    const api = getElectronUpdaterApi();
    if (api?.listVersions) {
      const result = await api.listVersions();
      const versions = result.versions || [];
      setState((prev) => ({
        ...prev,
        availableVersions: versions,
        currentVersion: result.currentVersion || prev.currentVersion,
      }));
      return versions;
    }

    try {
      const apiBase =
        typeof window !== "undefined" &&
        (window as Window & { customQuote?: { apiBase?: string } }).customQuote
          ?.apiBase
          ? (window as Window & { customQuote?: { apiBase?: string } }).customQuote!
              .apiBase!
          : process.env.NEXT_PUBLIC_API_URL || "http://localhost:5100";
      const response = await fetch(`${apiBase}/api/app-versions`);
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json()) as { versions?: string[] };
      const versions = payload.versions || [];
      setState((prev) => ({
        ...prev,
        availableVersions: versions,
      }));
      return versions;
    } catch {
      return [];
    }
  }, []);

  const installVersion = useCallback(async (version: string) => {
    const api = getElectronUpdaterApi();
    if (!api?.installVersion) {
      return {
        ok: false,
        error: "Version install is only available in the desktop app",
      };
    }

    setModalOpen(true);
    return api.installVersion(version);
  }, []);

  const onDownload = useCallback(async () => {
    const api = getElectronUpdaterApi();
    if (!api) {
      return;
    }
    await api.downloadUpdate();
  }, []);

  const onRemindLater = useCallback(async () => {
    const api = getElectronUpdaterApi();
    if (!api) {
      return;
    }
    await api.remindLater();
    setModalOpen(false);
  }, []);

  const onRestartNow = useCallback(async () => {
    const api = getElectronUpdaterApi();
    if (!api) {
      return;
    }

    if (state.installMode === "revert") {
      setModalOpen(false);
      return;
    }

    await api.quitAndInstall();
  }, [state.installMode]);

  const onRestartLater = useCallback(() => {
    setModalOpen(false);
  }, []);

  const updateAvailable = useMemo(() => {
    if (state.dismissed) {
      return false;
    }

    if (state.installMode === "revert") {
      return false;
    }

    const candidate = state.targetVersion || state.newVersion;
    if (
      candidate &&
      state.currentVersion &&
      compareVersions(candidate, state.currentVersion) <= 0
    ) {
      return false;
    }

    return (
      state.status === "available" ||
      state.status === "downloading" ||
      state.status === "downloaded" ||
      (state.status === "error" && Boolean(state.newVersion))
    );
  }, [state]);

  const availableVersions = state.availableVersions || [];

  const contextValue = useMemo(
    () => ({
      state,
      updateAvailable,
      availableVersions,
      modalOpen,
      openModal,
      closeModal,
      listVersions,
      installVersion,
    }),
    [
      state,
      updateAvailable,
      availableVersions,
      modalOpen,
      openModal,
      closeModal,
      listVersions,
      installVersion,
    ],
  );

  return (
    <UpdaterContext.Provider value={contextValue}>
      {children}
      <UpdateModal
        open={modalOpen}
        state={state}
        onClose={closeModal}
        onDownload={() => void onDownload()}
        onRemindLater={() => void onRemindLater()}
        onRestartNow={() => void onRestartNow()}
        onRestartLater={onRestartLater}
      />
    </UpdaterContext.Provider>
  );
}

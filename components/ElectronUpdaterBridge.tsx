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
import UpdateModal from "./UpdateModal";

const idleState: UpdaterSnapshot = {
  status: "idle",
  currentVersion: "",
  newVersion: null,
  percent: 0,
  error: null,
  dismissed: false,
};

type UpdaterContextValue = {
  state: UpdaterSnapshot;
  updateAvailable: boolean;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
};

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

export function useAppUpdater(): UpdaterContextValue {
  const context = useContext(UpdaterContext);
  if (!context) {
    return {
      state: idleState,
      updateAvailable: false,
      modalOpen: false,
      openModal: () => undefined,
      closeModal: () => undefined,
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
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

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
    await api.quitAndInstall();
  }, []);

  const onRestartLater = useCallback(() => {
    setModalOpen(false);
  }, []);

  const updateAvailable = useMemo(() => {
    if (state.dismissed) {
      return false;
    }

    return (
      state.status === "available" ||
      state.status === "downloading" ||
      state.status === "downloaded" ||
      (state.status === "error" && Boolean(state.newVersion))
    );
  }, [state]);

  const contextValue = useMemo(
    () => ({
      state,
      updateAvailable,
      modalOpen,
      openModal,
      closeModal,
    }),
    [state, updateAvailable, modalOpen, openModal, closeModal],
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

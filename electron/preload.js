const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronUpdater", {
  getState: () => ipcRenderer.invoke("updater:get-state"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  quitAndInstall: () => ipcRenderer.invoke("updater:quit-and-install"),
  remindLater: () => ipcRenderer.invoke("updater:remind-later"),
  onStatus: (callback) => {
    const listener = (_event, state) => {
      callback(state);
    };

    ipcRenderer.on("updater:status", listener);

    return () => {
      ipcRenderer.removeListener("updater:status", listener);
    };
  },
});

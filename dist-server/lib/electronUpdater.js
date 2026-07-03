"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getElectronUpdaterApi = getElectronUpdaterApi;
exports.isElectronApp = isElectronApp;
function getElectronUpdaterApi() {
    if (typeof window === "undefined") {
        return null;
    }
    return window.electronUpdater ?? null;
}
function isElectronApp() {
    return getElectronUpdaterApi() !== null;
}

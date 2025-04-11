const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onBackendReady: (callback) => ipcRenderer.on('BACKEND_READY', (_, data) => callback(data)),
    onBackendEvent: (callback) => ipcRenderer.on('BACKEND_EVENT', (_, data) => callback(data)),

    onFrontendSelectDirectory: () => ipcRenderer.invoke('FRONTEND_SELECT_DIRECTORY')
});
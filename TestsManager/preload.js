const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Notifies the renderer which port the backend was started on (dynamic port
    // selection in the desktop shell). In a browser the frontend falls back to
    // the default http://localhost:3000.
    onBackendReady: (callback) => ipcRenderer.on('BACKEND_READY', (_, data) => callback(data)),

    // Native folder picker for the desktop shell. The web UI uses the backend
    // /filesystem/list endpoint instead, so recording works without Electron.
    onFrontendSelectDirectory: () => ipcRenderer.invoke('FRONTEND_SELECT_DIRECTORY')
});
const { contextBridge, ipcRenderer } = require('electron');

// Optional desktop-only capabilities. The Frontend checks for window.thothDesktop
// and falls back to its web behaviour when it is absent (plain browser).
contextBridge.exposeInMainWorld('thothDesktop', {
    isDesktop: true,
    selectDirectory: () => ipcRenderer.invoke('thoth:select-directory')
});

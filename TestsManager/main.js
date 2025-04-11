const { app, ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { detectPort } = require('detect-port');
const express = require('express');

let mainWindow;

let frontendProcess;
let backendProcess;

let backendPort;

async function findFrontendPort() {
    let frontendPort = await detectPort(4200); // Start checking from 4200
    console.log(`✅ Free frontend port found: ${frontendPort}`);
    return frontendPort;
}

async function findBackendPort() {
    let backendPort = await detectPort(3000); // Start checking from 3000
    console.log(`✅ Free backend port found: ${backendPort}`);
    return backendPort;
}

async function spawnFrontend(serverPort) {
    const server = express();
    server.use(express.static(path.join(__dirname, 'Frontend/dist/thot-test-manager/browser'))); // Serve Angular app

    server.listen(serverPort, () => {
        console.log(`Angular app is being served at http://localhost:${serverPort}`);
    });

    return server;
}

async function spawnBackend(backendPort) {
    let backendProcess = spawn('node', ['Backend/dist/server.js', backendPort], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    backendProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        console.log(`Backend says: ${message}`);

        if (message.startsWith("BACKEND_EVENT:") &&mainWindow) {
            mainWindow.webContents.send('BACKEND_EVENT', message.replace("BACKEND_EVENT:", "").trim());
        }
    });

    backendProcess.stderr.on('data', (data) => {
        console.error(`Backend Error: ${data}`);
    });

    return backendProcess;
}

app.on('ready', async () => {
    const backendPort = await findBackendPort();
    backendProcess = await spawnBackend(backendPort);

    const frontendPort = await findFrontendPort();
    frontendProcess = await spawnFrontend(frontendPort);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,  // Disable direct Node.js access for security
            contextIsolation: true,  // Enable secure IPC communication
            preload: path.join(__dirname, 'preload.js') // Load secure preload script
        }
    });

    // mainWindow.setMenuBarVisibility(false);

    await mainWindow.loadURL(`http://localhost:${frontendPort}`);
    
    setTimeout(() => {
        mainWindow.webContents.send('BACKEND_READY', backendPort);
    }, 5000);

    mainWindow.on('closed', () => {
        if (backendProcess) backendProcess.kill();
        mainWindow = null;
    });
});

app.on('window-all-closed', () => {
    if (backendProcess) backendProcess.kill();
    app.quit();
});

ipcMain.handle('FRONTEND_SELECT_DIRECTORY', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
});
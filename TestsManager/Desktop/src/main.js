// Thoth Tests Manager - desktop shell.
//
// This is a thin host around the two independent projects: it runs the
// Backend build output (Backend/dist) on a bundled portable node.exe as a
// separate child process, and serves the Frontend build output through the
// privileged app:// protocol. Neither Backend nor Frontend knows about Electron;
// the only coupling points are:
//   - Backend env vars: PORT, THOTH_DATA_DIR
//   - Frontend runtime config: /config.json (overridden here with the real backend URL)
//   - Optional window.thothDesktop bridge (see preload.js)

const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const netSocket = require('net');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://thoth`;
const DEFAULT_BACKEND_PORT = 3000;
const BACKEND_START_TIMEOUT_MS = 60_000;
const SMOKE_TEST = process.argv.includes('--smoke-test') || process.env.THOTH_DESKTOP_SMOKE_TEST === '1';

protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow = null;
let backendProcess = null;
let backendUrl = null;
let quitting = false;

/** Where the Backend/Frontend build outputs and node.exe live (packaged vs. repo checkout). */
function resolveLayout() {
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    if (app.isPackaged) {
        const res = process.resourcesPath;
        return {
            backendDir: path.join(res, 'backend'),
            frontendDir: path.join(res, 'frontend'),
            nodeExe: path.join(res, 'node', nodeName)
        };
    }

    // Development: use the sibling projects' build outputs directly.
    const testsManagerDir = path.resolve(__dirname, '..', '..');
    const bundledNode = path.resolve(__dirname, '..', 'resources', 'node', nodeName);
    return {
        backendDir: path.join(testsManagerDir, 'Backend'),
        frontendDir: path.join(testsManagerDir, 'Frontend', 'dist', 'thot-test-manager', 'browser'),
        nodeExe: process.env.THOTH_NODE || (fs.existsSync(bundledNode) ? bundledNode : 'node')
    };
}

function isPortFree(port) {
    return new Promise((resolve) => {
        const server = netSocket.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port);
    });
}

async function findFreePort(start) {
    for (let port = start; port < start + 100; port++) {
        if (await isPortFree(port)) return port;
    }
    throw new Error(`No free port found in range ${start}-${start + 99}`);
}

function openLogStream() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    return fs.createWriteStream(path.join(logDir, 'backend.log'), { flags: 'a' });
}

function startBackend(layout, port, log) {
    const serverJs = path.join(layout.backendDir, 'dist', 'server.js');
    if (!fs.existsSync(serverJs)) {
        throw new Error(`Backend build output not found: ${serverJs}\nBuild it first (npm run build:all in TestsManager/Desktop).`);
    }

    const dataDir = app.getPath('userData');
    log.write(`\n=== ${new Date().toISOString()} starting backend: ${layout.nodeExe} ${serverJs} (PORT=${port}, THOTH_DATA_DIR=${dataDir})\n`);

    const child = spawn(layout.nodeExe, [serverJs], {
        cwd: layout.backendDir,
        env: { ...process.env, PORT: String(port), THOTH_DATA_DIR: dataDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    const forward = (target) => (chunk) => {
        log.write(chunk);
        target.write(`[backend] ${chunk}`);
    };
    child.stdout.on('data', forward(process.stdout));
    child.stderr.on('data', forward(process.stderr));
    return child;
}

function probeHealth(url) {
    return new Promise((resolve) => {
        const req = http.get(`${url}/health`, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => req.destroy());
    });
}

/** Resolves once GET /health answers 200; rejects if the process dies or the timeout elapses. */
function waitForBackend(url, child) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            child.off('exit', onExit);
            child.off('error', onError);
            fn(value);
        };
        const onExit = (code) => finish(reject, new Error(`Backend exited during startup (code ${code}).`));
        const onError = (err) => finish(reject, new Error(`Could not start backend: ${err.message}`));
        const timer = setTimeout(() => finish(reject, new Error('Timed out waiting for the backend to become ready.')), BACKEND_START_TIMEOUT_MS);
        child.once('exit', onExit);
        child.once('error', onError);

        const poll = async () => {
            if (done) return;
            if (await probeHealth(url)) return finish(resolve);
            setTimeout(poll, 250);
        };
        poll();
    });
}

/** Serves the Angular build from app://thoth/ with SPA fallback and a generated config.json. */
function registerFrontendProtocol(frontendDir) {
    const root = path.resolve(frontendDir);
    const indexHtml = path.join(root, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        throw new Error(`Frontend build output not found: ${indexHtml}\nBuild it first (npm run build:all in TestsManager/Desktop).`);
    }

    protocol.handle(APP_SCHEME, async (request) => {
        const { pathname } = new URL(request.url);
        const relative = decodeURIComponent(pathname);

        if (relative === '/config.json') {
            return new Response(JSON.stringify({ backendApiBaseUrl: backendUrl }), {
                headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
            });
        }

        const filePath = path.resolve(root, '.' + relative);
        const insideRoot = filePath.startsWith(root + path.sep);
        if (insideRoot && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return net.fetch(pathToFileURL(filePath).toString());
        }
        // Anything else is a client-side Angular route.
        return net.fetch(pathToFileURL(indexHtml).toString());
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        backgroundColor: '#121212',
        title: 'Thoth Tests Manager',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    mainWindow.setMenuBarVisibility(false);

    // External links open in the user's browser, never inside the app window.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(APP_ORIGIN)) {
            event.preventDefault();
            if (/^https?:/i.test(url)) shell.openExternal(url);
        }
    });

    if (!SMOKE_TEST) mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });
    return mainWindow;
}

function stopBackend() {
    if (backendProcess && backendProcess.exitCode === null) {
        backendProcess.kill();
    }
    backendProcess = null;
}

/** Headless self-check: Angular rendered, got config.json and actually called the backend. */
async function runSmokeTest() {
    const deadline = Date.now() + 30_000;
    let result = null;
    while (Date.now() < deadline) {
        result = await mainWindow.webContents.executeJavaScript(`(async () => {
            const config = await (await fetch('config.json', { cache: 'no-store' })).json();
            const health = await (await fetch(config.backendApiBaseUrl + '/health')).json();
            const backendCalls = performance.getEntriesByType('resource')
                .map(e => e.name).filter(n => n.startsWith(config.backendApiBaseUrl + '/') && !n.endsWith('/health'));
            return {
                location: location.href,
                rendered: !!document.querySelector('app-root')?.children.length,
                desktopBridge: !!(window.thothDesktop && window.thothDesktop.isDesktop),
                config, health, backendCalls
            };
        })()`);
        if (result.rendered && result.backendCalls.length > 0) break;
        await new Promise(r => setTimeout(r, 500));
    }
    const ok = !!(result && result.rendered && result.desktopBridge && result.health?.status === 'ok' && result.backendCalls.length > 0);
    const line = `[smoke-test] ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(result)}`;
    console.log(line);
    // GUI builds have no attached console on Windows, so also persist the result.
    fs.writeFileSync(path.join(app.getPath('userData'), 'logs', 'smoke-test.log'), `${new Date().toISOString()} ${line}\n`);
    return ok;
}

async function bootstrap() {
    const layout = resolveLayout();
    const log = openLogStream();

    const preferredPort = Number(process.env.THOTH_BACKEND_PORT) || DEFAULT_BACKEND_PORT;
    const port = await findFreePort(preferredPort);
    backendUrl = `http://localhost:${port}`;

    backendProcess = startBackend(layout, port, log);
    await waitForBackend(backendUrl, backendProcess);
    console.log(`Backend ready at ${backendUrl} (node: ${layout.nodeExe})`);

    backendProcess.on('exit', (code) => {
        if (quitting) return;
        dialog.showErrorBox('Thoth Tests Manager', `The backend stopped unexpectedly (code ${code}).\nSee ${path.join(app.getPath('userData'), 'logs', 'backend.log')}`);
        app.quit();
    });

    registerFrontendProtocol(layout.frontendDir);
    createWindow();
    await mainWindow.loadURL(`${APP_ORIGIN}/`);

    if (SMOKE_TEST) {
        const ok = await runSmokeTest();
        quitting = true;
        stopBackend();
        app.exit(ok ? 0 : 1);
    }
}

ipcMain.handle('thoth:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

if (!SMOKE_TEST && !app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(bootstrap).catch((error) => {
        console.error(error);
        quitting = true;
        stopBackend();
        if (!SMOKE_TEST) dialog.showErrorBox('Thoth Tests Manager failed to start', String((error && error.message) || error));
        app.exit(1);
    });

    app.on('before-quit', () => { quitting = true; stopBackend(); });
    app.on('window-all-closed', () => app.quit());
    process.on('exit', stopBackend);
}

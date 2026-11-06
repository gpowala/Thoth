# Thoth Tests Manager

Thoth Tests Manager is made of three projects in this folder:

| Project | What it is | Output |
|---------|------------|--------|
| [`Backend/`](Backend) | Node.js + Express + TypeScript API (Sequelize/SQLite, git via `simple-git`, image processing via `sharp`) | `Backend/dist/` |
| [`Frontend/`](Frontend) | Angular 18 web UI | `Frontend/dist/thot-test-manager/browser/` |
| [`Desktop/`](Desktop) | Thin Electron host that packages the two above as a Windows desktop app | `Desktop/release/` |

Backend and Frontend are independent: each can be developed, built and deployed on its own
(for example as two separate services in an enterprise environment). Neither depends on Electron.
The Desktop project only consumes their **build outputs**. It runs the backend on a bundled
portable `node.exe` and shows the frontend in an Electron window.

```
            ┌──────────── Desktop (optional) ─────────────┐
            │  node.exe ─► Backend/dist/server.js          │
            │  window   ─► Frontend/dist/.../browser       │
            └──────────────────────────────────────────────┘
Frontend (browser) ── HTTP (backendApiBaseUrl) ──► Backend (PORT, default 3000)
```

## Prerequisites

- **Node.js** with npm (tested with Node.js v24). The desktop build copies this Node.js into the app
  unless `THOTH_NODE_VERSION` is set (see [Desktop/README.md](Desktop/README.md)).
- **Git** on `PATH`: the backend uses it to clone and inspect test repositories.
- Windows for the desktop app and `dev.bat`. Backend and Frontend are cross-platform.

---

## Running Backend and Frontend separately

### Development (live reload)

From `TestsManager`, run:

```bat
dev.bat
```

It installs dependencies on first run. It then opens two windows:

- **Backend** at http://localhost:3000 (`npm run dev`: nodemon + ts-node, restarts on changes in `src`)
- **Frontend** at http://localhost:4200 (`npm start -- --open`: `ng serve` with live reload, opens your browser)

Or run each project yourself:

```bat
cd Backend
npm install
npm run dev

cd Frontend
npm install
npm start
```

### Production build and run

**Backend**

```bat
cd Backend
npm install
npm run build
npm start
```

`npm run build` compiles TypeScript to `dist/`. `npm start` runs `node dist/server.js`.
To deploy, copy `dist/`, `package.json` and `package-lock.json`, then run `npm install --omit=dev` on the target.

**Frontend**

```bat
cd Frontend
npm install
npm run build
```

The static site is written to `Frontend/dist/thot-test-manager/browser/`. Host it with any static web
server that falls back to `index.html` for unknown paths (Angular client-side routes, e.g. `/repositories`).
For a quick local check:

```bat
npx serve -s dist/thot-test-manager/browser
```

### Configuration

**Backend**

| Setting | Default | Purpose |
|---------|---------|---------|
| `PORT` env var | first command-line argument, then `3000` | HTTP port, e.g. `set PORT=3100 && npm start` |
| `THOTH_DATA_DIR` env var | unset | Folder for writable data. When set, `config.json`, the default SQLite database (`thoth_tests_manager.sqlite`) and the default `repositories` folder are placed here |
| `Backend/config.json` | `{ "databasePath": ... }` | SQLite database path. You can also change it in the app's Configuration page (`PUT /configuration`). When `THOTH_DATA_DIR` is set, `config.json` is read from that folder instead |

Without `THOTH_DATA_DIR`, the default database is `Backend/thoth_tests_manager.sqlite`. The default
repositories folder is `TestsManager/repositories`. The backend also exposes `GET /health`, which returns
`{ "status": "ok" }`, for readiness checks.

**Frontend**

The backend URL is read at startup from `config.json` next to `index.html`, so no rebuild is needed:

```json
{ "backendApiBaseUrl": "http://localhost:3000" }
```

The source is [`Frontend/public/config.json`](Frontend/public/config.json). It is copied into the build
output, where it can be edited per deployment. If the file is missing or invalid, the frontend uses
`http://localhost:3000`. The backend allows cross-origin requests (`Access-Control-Allow-Origin: *`), so
the two can be hosted on different origins.

---

## Desktop app (everything together)

From `TestsManager/Desktop`:

```bat
npm install
npm run build:all
npm start
```

- `npm install` runs once. Electron is downloaded the first time it runs.
- `npm run build:all` builds Backend and Frontend with their own scripts. It also stages the backend's
  production dependencies and copies a portable `node.exe` into the app.
- `npm start` runs the desktop app from those build outputs.

| Command | What it does |
|---------|--------------|
| `npm run smoke-test` | Headless check that the UI loads, gets its config and calls the backend. Exit code `0` means it passed |
| `npm run pack` | `build:all`, then an unpacked app in `Desktop/release/win-unpacked/` |
| `npm run dist` | `build:all`, then an installer (`Thoth Tests Manager Setup <version>.exe`) and a single-file portable app (`Thoth Tests Manager <version>.exe`) in `Desktop/release/` |

At startup the desktop app finds a free port, starting at `3000`. It starts the backend with `PORT` and
`THOTH_DATA_DIR` and waits for `GET /health`. It then serves the frontend with a generated `config.json`
that points at that port.

- **Data:** `%APPDATA%\Thoth Tests Manager\` holds `config.json`, `thoth_tests_manager.sqlite` and `repositories\`.
- **Logs:** `%APPDATA%\Thoth Tests Manager\logs\` holds `backend.log` and `smoke-test.log`.

See [Desktop/README.md](Desktop/README.md) for details: the portable Node.js options, environment
variables (`THOTH_NODE`, `THOTH_NODE_VERSION`, `THOTH_BACKEND_PORT`) and the full contract with Backend and Frontend.

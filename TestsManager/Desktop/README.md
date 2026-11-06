# Thoth Tests Manager — Desktop

A thin Electron host that packages the two independent projects into a desktop app.
It only consumes their **build outputs**; `Backend` and `Frontend` never import Electron and
remain independently runnable/deployable (see `../dev.bat` for development).

```
Desktop (Electron main process)
 ├─ spawns  resources/node/node.exe  backend/dist/server.js   (separate process, same runtime as enterprise)
 │            env: PORT=<free port, from 3000>  THOTH_DATA_DIR=%APPDATA%\Thoth Tests Manager
 │            readiness: polls GET /health
 └─ window   app://thoth/  -> Frontend/dist/.../browser  (SPA fallback to index.html)
              app://thoth/config.json is generated: { "backendApiBaseUrl": "http://localhost:<port>" }
```

## Contract with the other projects

| Project  | Integration point | Default when not in the desktop app |
|----------|-------------------|-------------------------------------|
| Backend  | `PORT` env var (falls back to first CLI arg) | `3000` |
| Backend  | `THOTH_DATA_DIR` env var — location of `config.json`, default SQLite DB and default repositories folder | next to the backend, as before |
| Backend  | `GET /health` | — |
| Frontend | `config.json` next to `index.html` (`backendApiBaseUrl`), read at startup | `http://localhost:3000` (`Frontend/public/config.json`) |
| Frontend | optional `window.thothDesktop` (native folder picker, see `src/preload.js`) | web fallback |

`config.json` is also how an enterprise/web deployment points the Frontend at its Backend without rebuilding.

## Commands (run in `TestsManager/Desktop`)

```bat
npm install            :: once (Electron itself is downloaded on first run)
npm run build:all      :: builds Backend + Frontend, stages backend prod deps, copies portable node.exe
npm start              :: run the desktop app against those build outputs
npm run smoke-test     :: headless check: UI loads, gets config.json, calls the backend; exit code 0 = pass
npm run pack           :: build:all + unpacked app in release/win-unpacked
npm run dist           :: build:all + NSIS installer and portable .exe in release/
```

- **Portable node.exe**: `scripts/prepare-node.js` copies the Node.js used for the build into
  `resources/node/`. Set `THOTH_NODE_VERSION=22.12.0` to download that official build instead.
  In `npm start`, if `resources/node/node.exe` is missing, the system `node` is used (or `THOTH_NODE`).
- **Backend dependencies**: `scripts/prepare-backend.js` installs production-only dependencies into
  `staging/backend` (Backend's own `node_modules` is untouched). `sqlite3` and `sharp` ship N-API
  prebuilds, so no Electron rebuild is needed — the backend runs on plain Node.
- **Data & logs**: `%APPDATA%\Thoth Tests Manager\` (`config.json`, `thoth_tests_manager.sqlite`,
  `repositories\`, `logs\backend.log`, `logs\smoke-test.log`).
- `THOTH_BACKEND_PORT` changes the first port tried (default `3000`).

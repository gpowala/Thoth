@echo off
setlocal enableextensions

rem ============================================================
rem  Thot Tests Manager - development launcher
rem  Runs the backend (auto-restart) and the Angular frontend
rem  (live-reload, opens in your browser) together.
rem ============================================================

set "ROOT=%~dp0"
set "BACKEND=%ROOT%Backend"
set "FRONTEND=%ROOT%Frontend"

echo ============================================================
echo   Thot Tests Manager - DEV mode
echo   Backend : http://localhost:3000   (nodemon, auto-restart)
echo   Frontend: http://localhost:4200   (ng serve, live-reload)
echo ============================================================
echo.

rem --- Install dependencies on first run -----------------------
if not exist "%BACKEND%\node_modules" (
  echo [setup] Installing backend dependencies...
  pushd "%BACKEND%" && call npm install && popd
)
if not exist "%FRONTEND%\node_modules" (
  echo [setup] Installing frontend dependencies...
  pushd "%FRONTEND%" && call npm install && popd
)

rem --- Start backend in watch mode (own window) ----------------
echo [start] Backend  -^> window "Thoth Backend"
start "Thoth Backend" /D "%BACKEND%" cmd /k npm run dev

rem --- Start frontend dev server, open the browser (own window) -
echo [start] Frontend -^> window "Thoth Frontend"
start "Thoth Frontend" /D "%FRONTEND%" cmd /k npm start -- --open

echo.
echo Both services are starting in separate windows.
echo The browser opens at http://localhost:4200 once Angular finishes building.
echo Close those two windows (or press Ctrl+C in each) to stop everything.
echo.

endlocal

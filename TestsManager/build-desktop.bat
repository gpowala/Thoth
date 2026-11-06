@echo off
setlocal enableextensions

rem ============================================================
rem  Thot Tests Manager - desktop app build
rem  Builds Backend + Frontend and packages them with Electron.
rem
rem  Usage: build-desktop.bat [dist^|pack]
rem    dist  (default) installer + portable .exe in Desktop\release
rem    pack  unpacked app only in Desktop\release\win-unpacked
rem ============================================================

set "ROOT=%~dp0"
set "BACKEND=%ROOT%Backend"
set "FRONTEND=%ROOT%Frontend"
set "DESKTOP=%ROOT%Desktop"
set "RELEASE=%DESKTOP%\release"
set "RC=0"

rem Keep the window open when started by double-click from Explorer.
set "PAUSE_AT_END="
echo %cmdcmdline% | find /i "%~nx0" >nul && set "PAUSE_AT_END=1"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=dist"
if /i not "%MODE%"=="dist" if /i not "%MODE%"=="pack" (
  echo [error] Unknown option "%~1".
  echo Usage: %~nx0 [dist^|pack]
  set "RC=2"
  goto :finish
)

echo ============================================================
echo   Thot Tests Manager - DESKTOP build (%MODE%)
echo   Output: %RELEASE%
echo ============================================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [error] npm was not found on PATH. Install Node.js first.
  set "RC=1"
  goto :finish
)

rem --- Install dependencies where missing ----------------------
call :install "%BACKEND%" Backend || goto :failed
call :install "%FRONTEND%" Frontend || goto :failed
call :install "%DESKTOP%" Desktop || goto :failed

rem --- Clean previous output so only fresh files are listed ----
if exist "%RELEASE%" (
  echo [clean] Removing previous %RELEASE%
  rmdir /s /q "%RELEASE%" 2>nul
  if exist "%RELEASE%" (
    echo [error] Could not remove %RELEASE%. Is the desktop app still running?
    set "RC=1"
    goto :finish
  )
)

rem --- Build Backend + Frontend and package (Desktop scripts) --
echo [build] npm run %MODE%  ^(in Desktop^)
pushd "%DESKTOP%"
call npm run %MODE%
set "RC=%errorlevel%"
popd
if not "%RC%"=="0" goto :failed

echo.
echo ============================================================
echo   Build succeeded. Output:
echo ============================================================
if /i "%MODE%"=="pack" (
  for %%F in ("%RELEASE%\win-unpacked\*.exe") do echo   %%~fF
) else (
  for %%F in ("%RELEASE%\*.exe") do echo   %%~fF
)
echo.
goto :finish

:failed
if "%RC%"=="0" set "RC=1"
echo.
echo [error] Desktop build FAILED (exit code %RC%). See the output above.

:finish
if defined PAUSE_AT_END pause
endlocal & exit /b %RC%

rem --- install <dir> <name>: npm install if node_modules is missing
:install
if exist "%~1\node_modules" exit /b 0
echo [setup] Installing %~2 dependencies...
pushd "%~1"
call npm install --no-audit --no-fund
set "INSTALL_RC=%errorlevel%"
popd
if not "%INSTALL_RC%"=="0" (
  echo [error] npm install failed in %~2.
  exit /b 1
)
exit /b 0

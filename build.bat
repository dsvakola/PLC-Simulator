@echo off
setlocal
cd /d "%~dp0"
title PLC ^& SCADA Simulator - Build

echo.
echo  PLC ^& SCADA Simulator - building the release
echo  ------------------------------------

where cargo >nul 2>nul
if errorlevel 1 (
  echo  Rust is not installed. Install it from https://rustup.rs and run this file again.
  goto :fail
)
where corepack >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Install it from https://nodejs.org and run this file again.
  goto :fail
)

rem pnpm comes with Node.js through Corepack. If it is not switched on for the
rem whole PC, switch it on in a folder for this user only (no admin needed).
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
where pnpm >nul 2>nul
if errorlevel 1 (
  if not exist "%LOCALAPPDATA%\VSA-pnpm" mkdir "%LOCALAPPDATA%\VSA-pnpm"
  call corepack enable --install-directory "%LOCALAPPDATA%\VSA-pnpm" pnpm
  if errorlevel 1 goto :fail
  set "PATH=%LOCALAPPDATA%\VSA-pnpm;%PATH%"
)

for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" src-tauri\tauri.conf.json') do set "VERSION=%%~v"
echo  Version %VERSION%
echo.

if not exist node_modules (
  echo  Installing build tools, first time only...
  call pnpm install --frozen-lockfile
  if errorlevel 1 goto :fail
)

rem Keep the build folder's own path out of the program: source paths are
rem written relative to this folder.
set "CARGO_ENCODED_RUSTFLAGS=--remap-path-prefix=%CD%=."

call pnpm tauri build
if errorlevel 1 goto :fail

if not exist Release mkdir Release
rem The portable program is a folder: the EXE with its licence and notice files.
set "PORTABLE=Release\PLC & SCADA Simulator %VERSION% Portable"
if not exist "%PORTABLE%" mkdir "%PORTABLE%"
copy /y "target\release\plc-simulator.exe" "%PORTABLE%\PLC & SCADA Simulator.exe" >nul
if errorlevel 1 goto :fail
for %%f in (LICENSE NOTICE THIRD-PARTY-NOTICES.txt privacy-policy.md) do (
  copy /y "%%f" "%PORTABLE%\" >nul
  if errorlevel 1 goto :fail
)
rem Copy only this version's installer. Older installers stay behind in the
rem build folder, so ones deleted from Release do not come back.
copy /y "target\release\bundle\nsis\PLC & SCADA Simulator_%VERSION%_x64-setup.exe" "Release\" >nul
if errorlevel 1 goto :fail

echo.
echo  Done. The installer and the portable folder are in the Release folder.
echo  For the Microsoft Store package, run msix.bat now.
dir /b Release
echo.
pause
exit /b 0

:fail
echo.
echo  The build did not finish. Please read the messages above.
pause
exit /b 1

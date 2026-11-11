@echo off
setlocal
cd /d "%~dp0"
title VSA Simulator - MSIX package

echo.
echo  VSA Simulator - making the MSIX package for the Microsoft Store
echo  ----------------------------------------------------------------
echo  Run build.bat first: this packs the program it built.

if not exist "target\release\vsa-simulator.exe" (
  echo  target\release\vsa-simulator.exe is missing. Run build.bat first.
  goto :fail
)

rem The newest Windows SDK tools (makeappx, makepri).
set "SDK="
for /f "delims=" %%d in ('dir /b /ad /o-n "%ProgramFiles(x86)%\Windows Kits\10\bin\10.*" 2^>nul') do (
  if not defined SDK if exist "%ProgramFiles(x86)%\Windows Kits\10\bin\%%d\x64\makeappx.exe" set "SDK=%ProgramFiles(x86)%\Windows Kits\10\bin\%%d\x64"
)
if not defined SDK (
  echo  The Windows SDK is not installed ^(makeappx.exe was not found^).
  goto :fail
)

for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" src-tauri\tauri.conf.json') do set "VERSION=%%~v"
set "MSIXVER=%VERSION%.0"
echo  Version %MSIXVER%
echo.

set "LAYOUT=target\msix\layout"
if exist "target\msix" rmdir /s /q "target\msix"
mkdir "%LAYOUT%\Assets"
copy /y "target\release\vsa-simulator.exe" "%LAYOUT%\" >nul || goto :fail
for %%f in (LICENSE NOTICE THIRD-PARTY-NOTICES.txt PRIVACY.md) do copy /y "%%f" "%LAYOUT%\" >nul || goto :fail
copy /y "msix\Assets\*.png" "%LAYOUT%\Assets\" >nul || goto :fail
powershell -NoProfile -Command "(Get-Content -Raw 'msix\AppxManifest.xml').Replace('@VERSION@','%MSIXVER%') | Set-Content -NoNewline -Encoding UTF8 '%LAYOUT%\AppxManifest.xml'" || goto :fail

rem resources.pri lets Windows pick the right image size for each screen.
"%SDK%\makepri.exe" createconfig /cf "target\msix\priconfig.xml" /dq en-US /pv 10.0.0 /o >nul || goto :fail
rem One resources.pri holding every image size (split files are for bundles only).
powershell -NoProfile -Command "$x=[xml](Get-Content -Raw 'target\msix\priconfig.xml'); foreach($n in @($x.SelectNodes('//packaging'))){ [void]$n.ParentNode.RemoveChild($n) }; $x.Save((Resolve-Path 'target\msix\priconfig.xml').Path)" || goto :fail
"%SDK%\makepri.exe" new /pr "%LAYOUT%" /cf "target\msix\priconfig.xml" /mn "%LAYOUT%\AppxManifest.xml" /of "%LAYOUT%\resources.pri" /o >nul || goto :fail

if not exist Release mkdir Release
set "OUT=Release\VSA-Simulator-%MSIXVER%.msix"
"%SDK%\makeappx.exe" pack /o /h SHA256 /d "%LAYOUT%" /p "%OUT%" >nul || goto :fail

echo  Done. Upload this file in Partner Center ^(Packages^):
echo    %OUT%
echo  It is not signed: the Microsoft Store signs it.
echo.
pause
exit /b 0

:fail
echo.
echo  The MSIX package was not made. Please read the messages above.
pause
exit /b 1

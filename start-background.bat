@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0start-background.vbs" (
    start "" wscript.exe "%~dp0start-background.vbs"
) else (
    powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start-background.ps1"
)

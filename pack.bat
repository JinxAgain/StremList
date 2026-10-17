@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title StremList Windows Packager
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack.ps1"
if %errorlevel% neq 0 (
    echo.
    echo [Error] Packaging encountered errors (exit code %errorlevel%).
    pause
)

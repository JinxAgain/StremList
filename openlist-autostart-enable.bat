@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

:: Check for Administrator privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ========================================================
    echo  [Admin Required] Requesting Administrator Privileges...
    echo ========================================================
    echo Configuring Windows Task Scheduler requires administrator rights.
    echo A UAC prompt will appear; please click [Yes] to proceed.
    echo.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs } catch { exit 1 }"
    if %errorlevel% neq 0 (
        echo [Error] Administrator privileges were not granted.
        echo Please right-click "%~nx0" and select "Run as administrator".
        echo.
        pause
    )
    exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0openlist-autostart-enable.ps1"
if %errorlevel% neq 0 (
    pause
)

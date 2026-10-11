@echo off
setlocal
chcp 65001 >nul
title StremList Packaging Tool
color 0a

echo ========================================================
echo       StremList Windows Packager
echo ========================================================
echo.

set "ZIP_NAME=StremList-Windows-Debug.zip"
set "TEMP_DIR=_pack_temp"

if exist "%ZIP_NAME%" del /f /q "%ZIP_NAME%"
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"

echo [1/3] Preparing files...
mkdir "%TEMP_DIR%"
xcopy "src" "%TEMP_DIR%\src\" /E /I /Q /Y >nul
copy "package.json" "%TEMP_DIR%\" /Y >nul
copy "package-lock.json" "%TEMP_DIR%\" /Y >nul
copy "tsconfig.json" "%TEMP_DIR%\" /Y >nul
copy ".env.example" "%TEMP_DIR%\" /Y >nul
copy "start.bat" "%TEMP_DIR%\" /Y >nul
copy "start.ps1" "%TEMP_DIR%\" /Y >nul
if exist "README.md" copy "README.md" "%TEMP_DIR%\" /Y >nul

echo [2/3] Compressing into %ZIP_NAME%...
powershell -NoProfile -Command "Compress-Archive -Path '%TEMP_DIR%\*' -DestinationPath '%ZIP_NAME%' -Force"

echo [3/3] Cleaning up temporary files...
rmdir /s /q "%TEMP_DIR%"

echo.
echo ========================================================
echo [Success] Packaging completed!
echo Created: %CD%\%ZIP_NAME%
echo.
echo Instructions for tester:
echo 1. Extract %ZIP_NAME% to any folder
echo 2. Double-click start.bat
echo 3. The configuration page opens in browser and debug logs will stream to console and debug.log
echo ========================================================
echo.
pause

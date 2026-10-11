# StremList Packaging Tool (PowerShell)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "StremList Packaging Tool"

Set-Location $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Green
Write-Host "       StremList Windows Packager" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green

$zipName = "StremList-Windows-Debug.zip"
$tempDir = Join-Path $PSScriptRoot "_pack_temp"

if (Test-Path $zipName) { Remove-Item -Force $zipName }
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }

Write-Host "[1/3] Preparing files..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $tempDir | Out-Null
Copy-Item "src" -Destination (Join-Path $tempDir "src") -Recurse
Copy-Item "package.json" -Destination $tempDir
Copy-Item "package-lock.json" -Destination $tempDir
Copy-Item "tsconfig.json" -Destination $tempDir
Copy-Item ".env.example" -Destination $tempDir
Copy-Item "start.bat" -Destination $tempDir
Copy-Item "start.ps1" -Destination $tempDir
if (Test-Path "start-background.bat") { Copy-Item "start-background.bat" -Destination $tempDir }
if (Test-Path "start-background.vbs") { Copy-Item "start-background.vbs" -Destination $tempDir }
if (Test-Path "start-background.ps1") { Copy-Item "start-background.ps1" -Destination $tempDir }
if (Test-Path "stop.bat") { Copy-Item "stop.bat" -Destination $tempDir }
if (Test-Path "stop.ps1") { Copy-Item "stop.ps1" -Destination $tempDir }
if (Test-Path "README.md") { Copy-Item "README.md" -Destination $tempDir }

Write-Host "[2/3] Compressing into $zipName..." -ForegroundColor Cyan
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force

Write-Host "[3/3] Cleaning up temporary files..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $tempDir

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "[Success] Packaging completed!" -ForegroundColor Green
Write-Host "Created: $(Join-Path $PSScriptRoot $zipName)" -ForegroundColor Yellow
Write-Host "`nInstructions for tester:" -ForegroundColor White
Write-Host "1. Extract $zipName to any folder"
Write-Host "2. Double-click start.bat (or run ./start.ps1)"
Write-Host "3. The configuration page opens in browser and debug logs will stream to console and debug.log"
Write-Host "========================================================`n" -ForegroundColor Green

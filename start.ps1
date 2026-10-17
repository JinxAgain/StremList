# StremList Windows Debug Launcher
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Host.UI.RawUI.WindowTitle = "StremList Addon Server - Debug Console"

Set-Location $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "      StremList Addon Server - Debug Console" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Check local portable Node.js
$localNodeDir = Join-Path $PSScriptRoot ".bin\node"
if (Test-Path (Join-Path $localNodeDir "node.exe")) {
    $env:PATH = "$localNodeDir;$env:PATH"
}

# 2. Check system or local Node.js environment
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[Notice] Node.js is not found on your system." -ForegroundColor Yellow
    Write-Host "Would you like to automatically download portable Node.js v20 (approx 35MB)?" -ForegroundColor Cyan
    $choice = Read-Host "Enter Y to download portable Node.js, or press Enter to install manually [Y/N]"
    if ($choice -match '^[Yy]$') {
        Write-Host "`n[Downloading] Fetching official portable Node.js v20 LTS..." -ForegroundColor Cyan
        $binDir = Join-Path $PSScriptRoot ".bin"
        if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
        $zipPath = Join-Path $binDir "node.zip"

        $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -Lo $zipPath $nodeUrl
        } else {
            Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath
        }

        Write-Host "[Extracting] Unpacking portable Node.js to local folder..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $binDir -Force
        Remove-Item -Force $zipPath

        $extracted = Join-Path $binDir "node-v20.18.0-win-x64"
        $targetNode = Join-Path $binDir "node"
        if (Test-Path $extracted) {
            if (Test-Path $targetNode) { Remove-Item -Recurse -Force $targetNode }
            Rename-Item $extracted "node"
        }

        $env:PATH = "$targetNode;$env:PATH"
        Write-Host "[Success] Portable Node.js is ready!`n" -ForegroundColor Green
    } else {
        Write-Host "`nOpening official Node.js download website..." -ForegroundColor Yellow
        Start-Process "https://nodejs.org/"
        Read-Host "After installation finishes, please restart this script..."
        exit
    }
}

$nodeVersion = & node -v
Write-Host "[Environment] Node.js version: $nodeVersion`n" -ForegroundColor Green

# 3. Check and generate .env config
if (-not (Test-Path (Join-Path $PSScriptRoot ".env"))) {
    $envExample = Join-Path $PSScriptRoot ".env.example"
    if (Test-Path $envExample) {
        Write-Host "[Config] Generating initial .env from .env.example..." -ForegroundColor Gray
        Copy-Item $envExample (Join-Path $PSScriptRoot ".env")
        Write-Host "[Config] Default .env configuration created.`n" -ForegroundColor Gray
    }
}

# 4. Check dependencies (npm install on first run)
$nodeModules = Join-Path $PSScriptRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[Setup] First time launch: installing dependencies (1-2 minutes)..." -ForegroundColor Yellow
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n[Error] npm install failed. Please check network connection!" -ForegroundColor Red
        Read-Host "Press Enter to exit..."
        exit
    }
    Write-Host "[Setup] Dependencies installed successfully!`n" -ForegroundColor Green
}

# 5. Start background browser launcher to open configure page
Write-Host "[Starting] Launching StremList Addon Server..." -ForegroundColor Cyan
Write-Host "[Notice] Configuration page will open at: http://127.0.0.1:7000/configure" -ForegroundColor Gray
Write-Host "[Notice] Logs will stream below and save simultaneously to debug.log" -ForegroundColor Gray
Write-Host "========================================================`n" -ForegroundColor Cyan

Start-Job -ScriptBlock {
    Start-Sleep -Seconds 2
    Start-Process "http://127.0.0.1:7000/configure"
} | Out-Null

# 6. Run server and tee logs to debug.log
$logFile = Join-Path $PSScriptRoot "debug.log"
$env:npm_config_loglevel = "error"
$env:NODE_NO_WARNINGS = "1"

$distFile = Join-Path $PSScriptRoot "dist\index.js"
$srcIndex = Join-Path $PSScriptRoot "src\index.ts"
$useDist = (Test-Path $distFile) -and (-not (Test-Path $srcIndex) -or ((Get-Item $distFile).LastWriteTime -ge (Get-Item $srcIndex).LastWriteTime))

if ($useDist) {
    & node "$distFile" 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $logFile
} else {
    & npm --silent run dev 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $logFile
}

Write-Host "`n========================================================" -ForegroundColor Yellow
Write-Host "[Exited] Server stopped. If an issue occurred, please send debug.log to the developer." -ForegroundColor Yellow
Read-Host "Press Enter to close window..."

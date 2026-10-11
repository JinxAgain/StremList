# StremList Windows Silent / Background Launcher
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# 1. Check local portable Node.js or system Node.js
$localNodeDir = Join-Path $PSScriptRoot ".bin\node"
if (Test-Path (Join-Path $localNodeDir "node.exe")) {
    $env:PATH = "$localNodeDir;$env:PATH"
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    # Silently download portable Node.js v20 LTS
    $binDir = Join-Path $PSScriptRoot ".bin"
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
    $zipPath = Join-Path $binDir "node.zip"
    $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
    
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        & curl.exe -sLo $zipPath $nodeUrl
    } else {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath -UseBasicParsing
    }
    
    Expand-Archive -Path $zipPath -DestinationPath $binDir -Force
    Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    
    $extracted = Join-Path $binDir "node-v20.18.0-win-x64"
    $targetNode = Join-Path $binDir "node"
    if (Test-Path $extracted) {
        if (Test-Path $targetNode) { Remove-Item -Recurse -Force $targetNode }
        Rename-Item $extracted "node"
    }
    $env:PATH = "$targetNode;$env:PATH"
}

# 2. Check and copy .env if missing
if (-not (Test-Path (Join-Path $PSScriptRoot ".env"))) {
    $envExample = Join-Path $PSScriptRoot ".env.example"
    if (Test-Path $envExample) {
        Copy-Item $envExample (Join-Path $PSScriptRoot ".env")
    }
}

# 3. Check and install dependencies if missing
$nodeModules = Join-Path $PSScriptRoot "node_modules"
if (-not (Test-Path $nodeModules)) {
    & npm install --quiet
}

# 4. Terminate any previous instance on port 7000 or from stremlist.pid
$pidFile = Join-Path $PSScriptRoot "stremlist.pid"
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        $p = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($p) {
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

$connections = Get-NetTCPConnection -LocalPort 7000 -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

# 5. Start StremList in hidden background process
$logFile = Join-Path $PSScriptRoot "debug.log"
$distFile = Join-Path $PSScriptRoot "dist\index.js"
$tsxCli = Join-Path $PSScriptRoot "node_modules\tsx\dist\cli.mjs"
$entryFile = Join-Path $PSScriptRoot "src\index.ts"

if (Test-Path $distFile) {
    $proc = Start-Process -FilePath "node.exe" -ArgumentList "`"$distFile`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $logFile -PassThru
} else {
    $proc = Start-Process -FilePath "node.exe" -ArgumentList "`"$tsxCli`" `"$entryFile`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $logFile -PassThru
}

if ($proc -and $proc.Id) {
    Set-Content -Path $pidFile -Value $proc.Id
}

# 6. Wait briefly for server to bind and launch configure page in browser
Start-Sleep -Seconds 2
Start-Process "http://127.0.0.1:7000/configure"

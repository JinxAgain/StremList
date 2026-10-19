# StremList Windows Silent / Background Launcher
param(
    [switch]$OpenBrowser
)

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

# Fast port 7000 process cleanup using netstat (avoids slow NetTCPIP module import)
$portMatches = netstat.exe -ano | Select-String ":7000\s+.*LISTENING\s+(\d+)"
foreach ($match in $portMatches) {
    if ($match.Matches.Groups[1].Value) {
        $ownerPid = [int]$match.Matches.Groups[1].Value
        if ($ownerPid -gt 0) {
            Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
        }
    }
}

# 5. Build if dist/index.js is missing or src has been modified
$distFile = Join-Path $PSScriptRoot "dist\index.js"
$srcIndex = Join-Path $PSScriptRoot "src\index.ts"
$needsBuild = (-not (Test-Path $distFile)) -or ((Get-Item $srcIndex).LastWriteTime -gt (Get-Item $distFile).LastWriteTime)
if ($needsBuild) {
    & npm run build
}

# 6. Start StremList in hidden background process with separate out/err logs
$outLog = Join-Path $PSScriptRoot "debug.log"
$errLog = Join-Path $PSScriptRoot "debug.err.log"
$tsxCli = Join-Path $PSScriptRoot "node_modules\tsx\dist\cli.mjs"
$entryFile = Join-Path $PSScriptRoot "src\index.ts"

$proc = if (Test-Path $distFile) {
    Start-Process -FilePath "node.exe" -ArgumentList "`"$distFile`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
} else {
    Start-Process -FilePath "node.exe" -ArgumentList "`"$tsxCli`"", "`"$entryFile`"" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
}

# 7. Record PID
if ($proc -and $proc.Id) {
    Set-Content -Path $pidFile -Value $proc.Id
}

# 8. Launch configure page in default browser only if requested
if ($OpenBrowser) {
    Start-Process "http://127.0.0.1:7000/configure"
}

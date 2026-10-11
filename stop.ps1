# StremList Server Stopper
Set-Location $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "         StremList Server - Stop Service" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

$stoppedAny = $false

# 1. Stop by recorded PID
$pidFile = Join-Path $PSScriptRoot "stremlist.pid"
if (Test-Path $pidFile) {
    $procId = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($procId) {
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Write-Host "[Stopped] Terminated StremList process (PID: $procId)" -ForegroundColor Green
            $stoppedAny = $true
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# 2. Check and clean up any process listening on port 7000
$connections = Get-NetTCPConnection -LocalPort 7000 -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "[Stopped] Terminated process on port 7000 (PID: $($conn.OwningProcess))" -ForegroundColor Green
        $stoppedAny = $true
    }
}

if ($stoppedAny) {
    Write-Host "`n[Success] StremList server has been stopped.`n" -ForegroundColor Green
} else {
    Write-Host "[Notice] No active StremList process was found running on port 7000.`n" -ForegroundColor Yellow
}

Start-Sleep -Seconds 1

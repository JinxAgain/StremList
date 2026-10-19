# OpenList Windows Task Scheduler Autostart Disabler
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null
Set-Location $PSScriptRoot

# 0. Ensure Administrator privileges (required for Windows Task Scheduler)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host " [Admin Required] Requesting Administrator Privileges..." -ForegroundColor Yellow
    Write-Host "========================================================" -ForegroundColor Yellow
    Write-Host "Modifying Windows Task Scheduler requires administrator rights." -ForegroundColor White
    Write-Host "A UAC prompt will appear; please click [Yes] to proceed.`n" -ForegroundColor White
    try {
        Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
        exit 0
    } catch {
        Write-Host "`n[Error] Administrator privileges were not granted!" -ForegroundColor Red
        Write-Host "Please right-click the script and select 'Run as administrator' (以管理员身份运行).`n" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# 1. Unregister Scheduled Tasks
$taskNames = @("OpenList_AutoStart", "OpenList", "AutoStart_OpenList")
foreach ($t in $taskNames) {
    $existing = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
    }
}

# 2. Clean up legacy Startup shortcuts and generated runner
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\*openlist*.lnk" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\*openlist*.lnk" -Force -ErrorAction SilentlyContinue

$generatedVbs = Join-Path $PSScriptRoot "openlist-background.vbs"
if (Test-Path $generatedVbs) {
    Remove-Item $generatedVbs -Force -ErrorAction SilentlyContinue
}

Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Success] OpenList autostart task removed." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "OpenList will no longer start automatically upon login.`n" -ForegroundColor White
Start-Sleep -Seconds 2

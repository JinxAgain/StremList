# StremList Windows Task Scheduler Autostart Enabler
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
    Write-Host "Configuring Windows Task Scheduler requires administrator rights." -ForegroundColor White
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

$taskName = "StremList_AutoStart"
$vbsPath = Join-Path $PSScriptRoot "start-background.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Host "[Error] $vbsPath not found!" -ForegroundColor Red
    exit 1
}

# 1. Create scheduled task action to run start-background.vbs silently via wscript.exe
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $PSScriptRoot

# 2. Trigger instantly at user logon with zero delay
$trigger = New-ScheduledTaskTrigger -AtLogOn

# 3. Task settings: run on battery, high priority, no execution timeout
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 4 -ExecutionTimeLimit 0

# 4. User principal: bind to current interactive user logon
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

# 5. Register or update the task
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

# 6. Clean up any legacy Startup folder shortcut to avoid duplicate launches
$startupPath = [System.Environment]::GetFolderPath('Startup')
$oldShortcut = Join-Path $startupPath "StremList.lnk"
if (Test-Path $oldShortcut) {
    Remove-Item -Path $oldShortcut -Force -ErrorAction SilentlyContinue
}

Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Success] StremList registered to Windows Task Scheduler!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "Task Name:        $taskName" -ForegroundColor Cyan
Write-Host "Target Script:    $vbsPath" -ForegroundColor White
Write-Host "Working Directory:$PSScriptRoot" -ForegroundColor White
Write-Host "`nStremList will now start instantly upon Windows login with high priority and zero delay." -ForegroundColor White
Write-Host "To remove autostart at any time, run autostart-disable.bat.`n" -ForegroundColor Gray
Start-Sleep -Seconds 2

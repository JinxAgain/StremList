# OpenList Windows Task Scheduler Autostart Enabler
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

$taskName = "OpenList_AutoStart"

# 1. Locate openlist.exe binary
$openlistBin = $null
$cmd = Get-Command openlist.exe -ErrorAction SilentlyContinue
if ($cmd) {
    $openlistBin = $cmd.Source
} else {
    $wingetMatch = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "openlist.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wingetMatch) {
        $openlistBin = $wingetMatch.FullName
    } elseif (Test-Path "C:\Scripts\openlist\openlist.exe") {
        $openlistBin = "C:\Scripts\openlist\openlist.exe"
    } elseif (Test-Path (Join-Path $PSScriptRoot "OpenList\openlist.exe")) {
        $openlistBin = Join-Path $PSScriptRoot "OpenList\openlist.exe"
    }
}

if (-not $openlistBin) {
    Write-Host "[Error] openlist.exe was not found in PATH or standard installation locations." -ForegroundColor Red
    Write-Host "Please ensure OpenList is installed (e.g. via 'winget install OpenListTeam.OpenList')." -ForegroundColor Yellow
    exit 1
}

# 2. Determine default OpenList working directory
# Defaults to user profile directory ($env:USERPROFILE) or existing data directory
$openlistWorkDir = $env:USERPROFILE
if (Test-Path (Join-Path $env:USERPROFILE "data\config.json")) {
    $openlistWorkDir = $env:USERPROFILE
} elseif (Test-Path "C:\Scripts\openlist\data\config.json") {
    $openlistWorkDir = "C:\Scripts\openlist"
} elseif (Test-Path (Join-Path $PSScriptRoot "OpenList\data\config.json")) {
    $openlistWorkDir = Join-Path $PSScriptRoot "OpenList"
}

# 3. Create or update silent runner script openlist-background.vbs
$vbsPath = Join-Path $PSScriptRoot "openlist-background.vbs"
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$openlistWorkDir"
WshShell.Run """$openlistBin"" server", 0, False
"@
Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

# 4. Register Scheduled Task with zero delay and high priority upon logon
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`"" -WorkingDirectory $openlistWorkDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 4 -ExecutionTimeLimit 0
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

# 5. Clean up any legacy Startup shortcuts to prevent duplicate launches
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\*openlist*.lnk" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup\*openlist*.lnk" -Force -ErrorAction SilentlyContinue

Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Success] OpenList registered to Windows Task Scheduler!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "Task Name:        $taskName" -ForegroundColor Cyan
Write-Host "Binary:           $openlistBin" -ForegroundColor White
Write-Host "Working Directory:$openlistWorkDir" -ForegroundColor White
Write-Host "`nOpenList will now start instantly upon Windows login with high priority and zero delay." -ForegroundColor White
Write-Host "To remove autostart at any time, run openlist-autostart-disable.bat.`n" -ForegroundColor Gray
Start-Sleep -Seconds 2

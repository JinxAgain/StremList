# StremList Windows Autostart Enabler
$ws = New-Object -ComObject WScript.Shell
$startupPath = [System.Environment]::GetFolderPath('Startup')
$targetScript = Join-Path $PSScriptRoot "start-background.vbs"
$shortcutFile = Join-Path $startupPath "StremList.lnk"

$shortcut = $ws.CreateShortcut($shortcutFile)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$targetScript`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "StremList Addon Server Background Runner"
$shortcut.Save()

Write-Host "========================================================" -ForegroundColor Green
Write-Host " [Success] StremList added to Windows Startup!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "Shortcut created at:"
Write-Host "  $shortcutFile" -ForegroundColor Cyan
Write-Host "`nStremList will now automatically start in the background when your computer boots up." -ForegroundColor White
Write-Host "To remove autostart at any time, run autostart-disable.bat.`n" -ForegroundColor Gray
Start-Sleep -Seconds 2

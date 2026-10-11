# StremList Windows Autostart Disabler
$startupPath = [System.Environment]::GetFolderPath('Startup')
$shortcutFile = Join-Path $startupPath "StremList.lnk"

if (Test-Path $shortcutFile) {
    Remove-Item $shortcutFile -Force -ErrorAction SilentlyContinue
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host " [Success] StremList removed from Windows Startup." -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "StremList will no longer automatically launch on boot.`n" -ForegroundColor White
} else {
    Write-Host "[Notice] StremList shortcut was not found in Startup folder.`n" -ForegroundColor Yellow
}

Start-Sleep -Seconds 1

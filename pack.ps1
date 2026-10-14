# StremList Packaging Tool (PowerShell)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "StremList Packaging Tool"

Set-Location $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Green
Write-Host "       StremList Windows Packager (Multi-Flavor)" -ForegroundColor Green
Write-Host "========================================================`n" -ForegroundColor Green

# 1. Compile fresh production build
Write-Host "[1/4] Compiling fresh production build (npm run build)..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[Error] Build failed! Please resolve TypeScript errors first." -ForegroundColor Red
    exit 1
}

# Function to build a specific flavor zip
function Build-Package($flavor, $zipName, $enableSubtitles) {
    Write-Host "`n--> Packaging $flavor into $zipName..." -ForegroundColor Cyan
    $tempDir = Join-Path $PSScriptRoot "_pack_temp_$flavor"

    if (Test-Path $zipName) { Remove-Item -Force $zipName }
    if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }

    New-Item -ItemType Directory -Path $tempDir | Out-Null

    # Core code & build artifacts
    Copy-Item "dist" -Destination (Join-Path $tempDir "dist") -Recurse
    Copy-Item "src" -Destination (Join-Path $tempDir "src") -Recurse
    Copy-Item "package.json" -Destination $tempDir
    Copy-Item "package-lock.json" -Destination $tempDir
    Copy-Item "tsconfig.json" -Destination $tempDir
    if (Test-Path "README.md") { Copy-Item "README.md" -Destination $tempDir }

    # Customized .env.example according to flavor
    $envContent = Get-Content ".env.example" -Raw
    if (-not $enableSubtitles) {
        $envContent = $envContent -replace 'SUBTITLE_ENABLED=true', 'SUBTITLE_ENABLED=false'
    }
    Set-Content -Path (Join-Path $tempDir ".env.example") -Value $envContent

    # Management scripts
    $scripts = @(
        "start.bat", "start.ps1",
        "start-background.bat", "start-background.vbs", "start-background.ps1",
        "configure.bat",
        "stop.bat", "stop.ps1",
        "autostart-enable.bat", "autostart-enable.ps1",
        "autostart-disable.bat", "autostart-disable.ps1"
    )
    foreach ($s in $scripts) {
        if (Test-Path $s) { Copy-Item $s -Destination $tempDir }
    }

    # Optional local portable node
    if (Test-Path ".bin") {
        Copy-Item ".bin" -Destination (Join-Path $tempDir ".bin") -Recurse
    }

    Write-Host "Compressing into $zipName..." -ForegroundColor Gray
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipName -Force
    Remove-Item -Recurse -Force $tempDir
    Write-Host "[Success] Created: $(Join-Path $PSScriptRoot $zipName)" -ForegroundColor Green
}

# 2. Package Plus Release (Chinese subtitles enabled by default)
Build-Package "Plus" "StremList-Plus-Windows.zip" $true

# 3. Package Lite Release (Pure cloud streaming, subtitles off by default)
Build-Package "Lite" "StremList-Lite-Windows.zip" $false

# 4. Package Debug Release (Full debug archive)
Build-Package "Debug" "StremList-Windows-Debug.zip" $true

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "[Success] All packages created successfully!" -ForegroundColor Green
Write-Host "1. StremList-Plus-Windows.zip   (Full: 115/PikPak + Chinese Subtitles)" -ForegroundColor Yellow
Write-Host "2. StremList-Lite-Windows.zip   (Lite: 115/PikPak Pure Cloud Streaming)" -ForegroundColor Yellow
Write-Host "3. StremList-Windows-Debug.zip  (Debug: Tester package with full scripts)" -ForegroundColor Yellow
Write-Host "========================================================`n" -ForegroundColor Green

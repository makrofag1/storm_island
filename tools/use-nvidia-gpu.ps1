# Storm Island helper: tell Windows to run your browsers on the dedicated (high-performance) GPU,
# e.g. NVIDIA GeForce GTX 1050 instead of Intel HD Graphics.
#
# This writes the same per-user setting as "Settings > System > Display > Graphics settings >
# High performance" (HKCU\Software\Microsoft\DirectX\UserGpuPreferences, GpuPreference=2).
# It only affects the current Windows user. To undo, run with -Undo.
#
# Usage (from the game folder):  powershell -ExecutionPolicy Bypass -File tools\use-nvidia-gpu.ps1
#                          undo:  powershell -ExecutionPolicy Bypass -File tools\use-nvidia-gpu.ps1 -Undo
param([switch]$Undo)

$key = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Mozilla Firefox\firefox.exe",
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "$env:LOCALAPPDATA\Programs\Opera\opera.exe",
  "$env:LOCALAPPDATA\Programs\Opera GX\opera.exe"
)

Write-Host "GPUs in this PC:"
Get-CimInstance Win32_VideoController | ForEach-Object { Write-Host "  - $($_.Name)" }

if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
$found = $candidates | Where-Object { Test-Path $_ } | Select-Object -Unique
if (-not $found) { Write-Host "No supported browser found in the usual locations."; exit 1 }

foreach ($exe in $found) {
  if ($Undo) {
    Remove-ItemProperty -Path $key -Name $exe -ErrorAction SilentlyContinue
    Write-Host "Reset to Windows default: $exe"
  } else {
    Set-ItemProperty -Path $key -Name $exe -Value 'GpuPreference=2;'
    Write-Host "High performance GPU:      $exe"
  }
}

Write-Host ""
Write-Host "Done. Close the browser COMPLETELY (all windows + tray icon) and start it again."
Write-Host "Then open Storm Island - the main menu shows which GPU is used (should say NVIDIA GeForce ...)."
Write-Host "Claude desktop app (Microsoft Store): set it by hand in Settings > System > Display > Graphics settings > Microsoft Store app > Claude > High performance."

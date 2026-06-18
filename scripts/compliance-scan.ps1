# scripts/compliance-scan.ps1
# Compliance gate. Exit 1 if any red-line pattern is found. See
# docs/compliance/compliance-verification-checklist.md stage A.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$fail = $false

function Report($msg, $hits) {
  if ($hits) { Write-Host "FAIL: $msg" -ForegroundColor Red; $hits | ForEach-Object { Write-Host "  $_" }; $script:fail = $true }
}

# A2/A3: no injection / memory / render-hook / simulated-input APIs anywhere in src.
$banned = 'ReadProcessMemory|WriteProcessMemory|CreateRemoteThread|SetWindowsHookEx|SendInput|keybd_event|mouse_event'
$srcTs = Get-ChildItem -Path $root -Recurse -Include *.ts -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\tests?\\' -and $_.FullName -notmatch '\\docs\\' }
Report 'banned injection/input API present' (
  $srcTs | Select-String -Pattern $banned | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })

# A1 back door: brand as-casts may appear ONLY inside main/src/ffi/.
$brandCast = 'as\s+ReadonlyGameHwnd|as\s+OwnOverlayHwnd'
Report 'brand cast outside main/src/ffi/' (
  $srcTs | Where-Object { $_.FullName -notmatch '\\main\\src\\ffi\\' } |
    Select-String -Pattern $brandCast | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })

# A1: write APIs must not appear outside the overlay_window_ctl module.
$writeApi = 'SetWindowPos|SetWindowLong|SetWindowLongPtr|SetWindowDisplayAffinity|\bShowWindow\b|\bMoveWindow\b'
Report 'Win32 write API outside overlay_window_ctl.ts' (
  $srcTs | Where-Object { $_.FullName -notmatch 'overlay_window_ctl\.ts$' } |
    Select-String -Pattern $writeApi | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" })

if ($fail) { Write-Host "`nCOMPLIANCE SCAN FAILED" -ForegroundColor Red; exit 1 }
Write-Host "compliance scan clean" -ForegroundColor Green; exit 0

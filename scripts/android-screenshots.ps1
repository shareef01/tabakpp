# Captures Android screenshots in Signal red (#FF5F5F) for the README.
# Requires: adb + unlocked device with com.tabakpp.app installed and signed in.
#
#   powershell -File scripts/android-screenshots.ps1 [-Serial SERIAL]
#
param(
  [string]$Serial = "",
  [string]$OutRoot = ""
)

$ErrorActionPreference = "Stop"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb not found at $adb" }

if (-not $OutRoot) {
  $OutRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "assets\screenshots\android\red"
}
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  if ($Serial) {
    $out = & $adb -s $Serial @Args 2>&1
  } else {
    $out = & $adb @Args 2>&1
  }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) {
    throw ("adb failed ($code): {0}`n{1}" -f ($Args -join ' '), ($out | Out-String))
  }
  return $out
}

function Get-UiXml {
  $remote = "/sdcard/uidump.xml"
  $null = Invoke-Adb shell uiautomator dump $remote
  $local = Join-Path $env:TEMP "tabakpp-uidump.xml"
  $null = Invoke-Adb pull $remote $local
  return [xml](Get-Content -Raw -LiteralPath $local)
}

function Find-Bounds {
  param([string]$ContentDesc, [string]$Text)
  $xml = Get-UiXml
  foreach ($n in $xml.SelectNodes("//node")) {
    $ok = $false
    if ($ContentDesc -and $n.GetAttribute("content-desc") -eq $ContentDesc) { $ok = $true }
    if ($Text -and $n.GetAttribute("text") -eq $Text) { $ok = $true }
    if (-not $ok) { continue }
    $b = $n.GetAttribute("bounds")
    if ($b -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
      return @{
        X = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
        Y = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
      }
    }
  }
  return $null
}

function Tap-Target {
  param([string]$ContentDesc, [string]$Text)
  $c = Find-Bounds -ContentDesc $ContentDesc -Text $Text
  if (-not $c) {
    $label = if ($ContentDesc) { "desc=$ContentDesc" } else { "text=$Text" }
    throw "UI node not found: $label"
  }
  $null = Invoke-Adb shell input tap $c.X $c.Y
  Start-Sleep -Milliseconds 1000
}

function Ensure-AccentVisible([string]$Desc) {
  for ($i = 0; $i -lt 8; $i++) {
    $c = Find-Bounds -ContentDesc $Desc
    if ($c) { return $c }
    $null = Invoke-Adb shell input swipe 540 1700 540 800 300
    Start-Sleep -Milliseconds 450
  }
  throw "Could not bring into view: $Desc"
}

function Capture-Shot([string]$Path) {
  $dir = Split-Path $Path -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $remote = "/data/local/tmp/tabakpp-shot.png"
  $tmp = Join-Path $env:TEMP "tabakpp-shot.png"
  $null = Invoke-Adb shell "screencap -p $remote"
  $null = Invoke-Adb pull $remote $tmp
  Copy-Item -LiteralPath $tmp -Destination $Path -Force
  $null = Invoke-Adb shell "rm $remote"
  if (-not (Test-Path $Path) -or (Get-Item $Path).Length -lt 1000) {
    throw "Screenshot failed or too small: $Path"
  }
  Write-Host "  captured $Path ($((Get-Item $Path).Length) bytes)"
}

if (-not $Serial) {
  $lines = & $adb devices | Where-Object { $_ -match "device$" -and $_ -notmatch "List" }
  if (-not $lines) { throw "No adb device connected - plug in the Pixel and unlock it." }
  $Serial = ($lines[0] -split "\s+")[0]
}

Write-Host "Using device $Serial (Signal red)"
$null = Invoke-Adb shell am force-stop com.tabakpp.app
Start-Sleep -Seconds 1
$null = Invoke-Adb shell am start -n com.tabakpp.app/.MainActivity
Start-Sleep -Seconds 3

$focus = (Invoke-Adb shell dumpsys window) | Out-String
if ($focus -notmatch "com\.tabakpp\.app") {
  throw "tabakpp is not focused - unlock the device and keep the app in foreground."
}

# Closest true red in the Android palette
$accentDesc = "Signal red accent"

Tap-Target -Text "Settings"
Start-Sleep -Milliseconds 500
Ensure-AccentVisible $accentDesc | Out-Null
Tap-Target -ContentDesc $accentDesc
Start-Sleep -Milliseconds 1400

Tap-Target -Text "Track"
Start-Sleep -Milliseconds 900
Capture-Shot (Join-Path $OutRoot "track.png")

Tap-Target -Text "History"
Start-Sleep -Milliseconds 1100
Capture-Shot (Join-Path $OutRoot "history.png")

Tap-Target -Text "Settings"
Start-Sleep -Milliseconds 900
Capture-Shot (Join-Path $OutRoot "settings.png")

Write-Host "`nDone. Android red shots in $OutRoot"

# Captures Android screenshots across accent themes on a connected device.
# Requires: adb + unlocked device with com.tabakpp.app installed and signed in.
#
#   powershell -File scripts/android-screenshots.ps1 [-Serial SERIAL]
#
param(
  [string]$Serial = "31071FDH2007WT",
  [string]$OutRoot = ""
)

$ErrorActionPreference = "Stop"
$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb not found at $adb" }

if (-not $OutRoot) {
  $OutRoot = Join-Path (Split-Path $PSScriptRoot -Parent) "assets\screenshots\android"
}
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $out = & $adb -s $Serial @Args 2>&1
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
  param([string]$ContentDesc, [string]$Text, [switch]$ClickableOnly)
  $xml = Get-UiXml
  foreach ($n in $xml.SelectNodes("//node")) {
    $ok = $false
    if ($ContentDesc -and $n.GetAttribute("content-desc") -eq $ContentDesc) { $ok = $true }
    if ($Text -and $n.GetAttribute("text") -eq $Text) { $ok = $true }
    if (-not $ok) { continue }
    if ($ClickableOnly -and $n.GetAttribute("clickable") -ne "true") {
      # Prefer nearest clickable ancestor by walking up via index path is hard in XML;
      # fall through and use this node's bounds (Compose text sits inside the hit target).
    }
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

Write-Host "Using device $Serial"
$null = Invoke-Adb shell am force-stop com.tabakpp.app
Start-Sleep -Seconds 1
$null = Invoke-Adb shell am start -n com.tabakpp.app/.MainActivity
Start-Sleep -Seconds 3

# Confirm we are in the app before automating.
$focus = (Invoke-Adb shell dumpsys window) | Out-String
if ($focus -notmatch "com\.tabakpp\.app") {
  throw "tabakpp is not focused - unlock the device and keep the app in foreground."
}

# Map README theme slugs to Android AccentPalette content descriptions.
$themes = @(
  @{ slug = "emerald"; desc = "Emerald accent" },
  @{ slug = "cobalt"; desc = "Cobalt accent" },
  @{ slug = "rose"; desc = "Magenta accent" },
  @{ slug = "violet"; desc = "Violet accent" }
)

foreach ($theme in $themes) {
  Write-Host "`ntheme $($theme.slug)"
  Tap-Target -Text "Settings"
  Start-Sleep -Milliseconds 500
  Ensure-AccentVisible $theme.desc | Out-Null
  Tap-Target -ContentDesc $theme.desc
  Start-Sleep -Milliseconds 1400

  Tap-Target -Text "Track"
  Start-Sleep -Milliseconds 900
  Capture-Shot (Join-Path $OutRoot "$($theme.slug)\track.png")

  Tap-Target -Text "History"
  Start-Sleep -Milliseconds 1100
  Capture-Shot (Join-Path $OutRoot "$($theme.slug)\history.png")

  Tap-Target -Text "Settings"
  Start-Sleep -Milliseconds 900
  Capture-Shot (Join-Path $OutRoot "$($theme.slug)\settings.png")
}

Write-Host "`nDone. Android shots in $OutRoot"

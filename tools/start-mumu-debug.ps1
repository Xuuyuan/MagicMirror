param(
  [switch]$DevelopmentBuild,
  [switch]$SkipInstall,
  [int]$AdbServerPort = $(if ($env:ANDROID_ADB_SERVER_PORT) { [int]$env:ANDROID_ADB_SERVER_PORT } else { 5037 })
)

$ErrorActionPreference = 'Stop'

$device = '127.0.0.1:16384'
$metroPort = 8081
$expoGo = 'host.exp.exponent'
$appPackage = if ($DevelopmentBuild) { 'com.magicmirror.app' } else { $expoGo }
$appUrl = if ($DevelopmentBuild) { "magicmirror://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$metroPort" } else { "exp://127.0.0.1:$metroPort" }

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw 'adb was not found. Add Android SDK platform-tools to PATH.'
}

Write-Host "Connecting MuMu: $device"
Write-Host "Using ADB server port: $AdbServerPort"
adb -P $AdbServerPort connect $device | Out-Host
adb -P $AdbServerPort -s $device wait-for-device

Write-Host "Forwarding Metro port: $metroPort"
adb -P $AdbServerPort -s $device reverse "tcp:$metroPort" "tcp:$metroPort" | Out-Host

if ($DevelopmentBuild -and -not $SkipInstall) {
  $version = (Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
  $apkPath = Join-Path $PSScriptRoot "..\dist\MagicMirror-$version-debug.apk"
  if (Test-Path -LiteralPath $apkPath) {
    # Emulators running ARM builds through native bridging fail to load
    # libreactnative.so, which only shows up as a blank screen.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($apkPath)
    try {
      $apkAbis = $zip.Entries | Where-Object { $_.FullName -like 'lib/*/*.so' } | ForEach-Object { ($_.FullName -split '/')[1] } | Sort-Object -Unique
    }
    finally {
      $zip.Dispose()
    }
    $deviceAbi = (adb -P $AdbServerPort -s $device shell -T getprop ro.product.cpu.abi | Select-Object -First 1).Trim()
    if ($apkAbis -and $deviceAbi -and $apkAbis -notcontains $deviceAbi) {
      Write-Warning "This APK only has $($apkAbis -join '/'), but the device is $deviceAbi; the app will crash on launch. Rebuild with: npm run build:debug:mumu"
    }
    # -d allows replacing an installed build with a lower versionCode, which the
    # local update test needs when the local version is lowered on purpose.
    Write-Host "Installing $apkPath"
    adb -P $AdbServerPort -s $device install -r -d $apkPath | Out-Host
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to install the debug APK (exit code $LASTEXITCODE): $apkPath"
    }
  } else {
    Write-Host "Skipping install: $apkPath not found. Build it with npm run build:debug:mumu."
  }
}

Write-Host "Starting $appPackage"
adb -P $AdbServerPort -s $device shell -T am force-stop $appPackage

if (Get-NetTCPConnection -State Listen -LocalPort $metroPort -ErrorAction SilentlyContinue) {
  Write-Host "Reusing the existing Expo server on port $metroPort"
  adb -P $AdbServerPort -s $device shell -T am start -a android.intent.action.VIEW -d $appUrl -p $appPackage | Out-Host
  exit 0
}

Write-Host 'Starting Expo and loading the Android project'
$expoArguments = if ($DevelopmentBuild) {
  @('expo', 'start', '--dev-client', '--host', 'lan', '--port', "$metroPort")
} else {
  @('expo', 'start', '--go', '--host', 'lan', '--port', "$metroPort")
}
$expoProcess = Start-Process -FilePath 'npx.cmd' -ArgumentList $expoArguments -WorkingDirectory (Get-Location).Path -PassThru
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    if (Get-NetTCPConnection -State Listen -LocalPort $metroPort -ErrorAction SilentlyContinue) {
      $ready = $true
      break
    }
    if ($expoProcess.HasExited) {
      throw "Expo failed to start (exit code $($expoProcess.ExitCode))."
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Metro did not start on port $metroPort."
  }
  Write-Host "Opening the development build on $device"
  adb -P $AdbServerPort -s $device shell -T am start -a android.intent.action.VIEW -d $appUrl -p $appPackage | Out-Host
}
finally {
  if ($expoProcess.HasExited -eq $false) {
    Write-Host "Metro is running in process $($expoProcess.Id)."
  }
}

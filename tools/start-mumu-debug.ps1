$ErrorActionPreference = 'Stop'

$device = '127.0.0.1:16384'
$metroPort = 8081
$expoGo = 'host.exp.exponent'

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw 'adb was not found. Add Android SDK platform-tools to PATH.'
}

Write-Host "Connecting MuMu: $device"
adb connect $device | Out-Host
adb -s $device wait-for-device

Write-Host "Forwarding Metro port: $metroPort"
adb -s $device reverse "tcp:$metroPort" "tcp:$metroPort" | Out-Host

Write-Host 'Starting Expo Go'
adb -s $device shell am force-stop $expoGo

if (Get-NetTCPConnection -State Listen -LocalPort $metroPort -ErrorAction SilentlyContinue) {
  Write-Host "Reusing the existing Expo server on port $metroPort"
  adb -s $device shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:$metroPort" | Out-Host
  exit 0
}

Write-Host 'Starting Expo and loading the Android project'
npx expo start --android --port $metroPort

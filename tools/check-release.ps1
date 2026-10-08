[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$package = Get-Content package.json -Raw | ConvertFrom-Json
$app = Get-Content app.json -Raw | ConvertFrom-Json
$lockHead = (Get-Content package-lock.json -TotalCount 12) -join "`n"
$lockVersions = [regex]::Matches($lockHead, '"version"\s*:\s*"([^"]+)"')
$expected = $package.version

if ($expected -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$') {
    throw 'package.json version is not a valid release version.'
}
if ($app.expo.version -ne $expected -or $lockVersions.Count -ne 2 -or $lockVersions[0].Groups[1].Value -ne $expected -or $lockVersions[1].Groups[1].Value -ne $expected) {
    throw "Release version metadata is inconsistent; expected $expected."
}
if ($app.expo.android.versionCode -isnot [int] -or $app.expo.android.versionCode -lt 1) {
    throw 'android.versionCode must be a positive integer.'
}

if ($package.private -ne $true) {
    throw "package.json must keep private=true to prevent accidental npm publishing."
}

Write-Host "Release version check passed: $expected (Android versionCode $($app.expo.android.versionCode))"

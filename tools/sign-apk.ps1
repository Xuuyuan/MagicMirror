[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$KeystorePath = (Join-Path $env:USERPROFILE 'AndroidSigning\magicmirror-release.p12'),
    [string]$KeyAlias = 'magicmirror',
    [string]$AndroidSdk = '',
    [switch]$NonInteractive,
    [string]$ExpectedCertificateSha256 = ''
)

$ErrorActionPreference = 'Stop'
if (-not $AndroidSdk) {
    $AndroidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
}
foreach ($requiredPath in @($InputPath, $KeystorePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "未找到签名输入：$requiredPath" }
}
$apkSignerName = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'apksigner.bat' } else { 'apksigner' }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $AndroidSdk 'build-tools') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName $apkSignerName)) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw '未找到 Android SDK apksigner，请安装稳定版 Build Tools。' }
$apkSigner = Join-Path $buildTools.FullName $apkSignerName
if ($NonInteractive -and (-not $env:ANDROID_KEYSTORE_PASSWORD -or -not $env:ANDROID_KEY_PASSWORD)) {
    throw 'Non-interactive signing requires ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_PASSWORD.'
}
if ($ExpectedCertificateSha256 -and $ExpectedCertificateSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'Expected certificate SHA-256 must contain exactly 64 hexadecimal characters.'
}
$inputApk = (Resolve-Path -LiteralPath $InputPath).Path
$outputApk = [IO.Path]::GetFullPath($OutputPath)
if ($inputApk -eq $outputApk) { throw '签名输入与输出必须使用不同文件，以保留构建产物。' }
$outputDirectory = Split-Path -Parent $outputApk
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$pendingApk = Join-Path $outputDirectory ('.signing-' + [guid]::NewGuid().ToString('N') + '.apk')
try {
    $signArguments = @('sign', '--ks', $KeystorePath, '--ks-key-alias', $KeyAlias, '--v4-signing-enabled', 'false', '--out', $pendingApk)
    if ($NonInteractive) {
        $signArguments += @('--ks-pass', 'env:ANDROID_KEYSTORE_PASSWORD', '--key-pass', 'env:ANDROID_KEY_PASSWORD')
    } else {
        Write-Host '请在终端提示时输入发布密钥密码；密码不会写入脚本或日志。'
    }
    & $apkSigner @signArguments $inputApk
    if ($LASTEXITCODE -ne 0) { throw 'APK 签名失败，原有发布包未被替换。' }
    & $apkSigner verify --verbose $pendingApk
    if ($LASTEXITCODE -ne 0) { throw 'APK 签名校验失败，原有发布包未被替换。' }
    if ($ExpectedCertificateSha256) {
        $certificateOutput = (& $apkSigner verify --print-certs $pendingApk) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw 'Certificate verification failed.' }
        $certificateHashes = [regex]::Matches($certificateOutput, 'certificate SHA-256 digest: ([0-9a-fA-F]{64})')
        if ($certificateHashes.Count -ne 1 -or $certificateHashes[0].Groups[1].Value -ine $ExpectedCertificateSha256) {
            throw 'Signing certificate differs from the expected release certificate.'
        }
    }
    Move-Item -LiteralPath $pendingApk -Destination $outputApk -Force
    Write-Host "正式签名 APK：$outputApk"
}
finally {
    if (Test-Path -LiteralPath $pendingApk) { Remove-Item -LiteralPath $pendingApk -Force }
}

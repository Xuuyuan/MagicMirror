[CmdletBinding()]
param(
    [string]$OutputPath = "",
    [ValidateSet("all", "arm64-v8a", "armeabi-v7a", "x86", "x86_64")]
    [string]$Architectures = "arm64-v8a",
    [switch]$Clean,
    [switch]$DebugBuild,
    [string]$KeystorePath = (Join-Path $env:USERPROFILE 'AndroidSigning\magicmirror-release.p12'),
    [string]$KeyAlias = 'magicmirror'
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot
$packageJsonPath = Join-Path $repoRoot "package.json"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$FilePath $($Arguments -join ' ')"
    }
}

if (-not (Test-Path "package.json")) {
    throw "未找到 package.json，请从项目根目录运行此脚本。"
}
$packageJsonBeforePrebuild = [IO.File]::ReadAllBytes($packageJsonPath)
& (Join-Path $PSScriptRoot 'check-release.ps1')
if (-not $OutputPath) {
    $releaseVersion = (Get-Content $packageJsonPath -Raw | ConvertFrom-Json).version
    $artifactKind = if ($DebugBuild) { 'debug' } else { 'signed' }
    $OutputPath = "dist\MagicMirror-$releaseVersion-$artifactKind.apk"
}
if (-not $DebugBuild -and -not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "未找到发布密钥：$KeystorePath。请使用现有密钥，或通过 -KeystorePath 指定路径。"
}

$androidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (-not $androidSdk -or -not (Test-Path $androidSdk)) {
    throw "未找到 Android SDK。请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT。"
}

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw "未找到 Java。请安装 JDK 并将 java 加入 PATH。"
}

$prebuildArguments = @("expo", "prebuild", "--platform", "android", "--no-install")
if ($Clean) {
    $prebuildArguments += "--clean"
} else {
    $prebuildArguments += "--no-clean"
}
Write-Host "生成 Android 原生工程..."
try {
    Invoke-Checked "npx" $prebuildArguments
}
finally {
    [IO.File]::WriteAllBytes($packageJsonPath, $packageJsonBeforePrebuild)
}

$buildType = if ($DebugBuild) { 'debug' } else { 'release' }
$buildTask = if ($DebugBuild) { 'assembleDebug' } else { 'assembleRelease' }
$gradleArguments = @($buildTask, "--no-daemon")
if ($Architectures -ne "all") {
    $gradleArguments += "-PreactNativeArchitectures=$Architectures"
}
$gradleJvmOptions = @()

function Add-GradleProxyArgument {
    param(
        [string]$EnvironmentName,
        [string]$PropertyPrefix
    )

    $proxyValue = [Environment]::GetEnvironmentVariable($EnvironmentName)
    if (-not $proxyValue) {
        return
    }

    try {
        $proxyUri = [Uri]$proxyValue
        if ($proxyUri.Host -and $proxyUri.Port -gt 0) {
            # PowerShell 7 can pass -Dhttps.proxyHost=... to gradlew.bat as a
            # Gradle task argument. Put JVM properties in GRADLE_OPTS instead,
            # which is handled by the wrapper before Gradle parses task names.
            $script:gradleJvmOptions += "-D$PropertyPrefix.proxyHost=$($proxyUri.Host)"
            $script:gradleJvmOptions += "-D$PropertyPrefix.proxyPort=$($proxyUri.Port)"
        }
    }
    catch {
        Write-Warning "忽略无法解析的 $EnvironmentName 代理配置。"
    }
}

Add-GradleProxyArgument "HTTPS_PROXY" "https"
Add-GradleProxyArgument "HTTP_PROXY" "http"

$gradleWrapper = Join-Path $repoRoot "android\gradlew.bat"
if (-not (Test-Path $gradleWrapper)) {
    throw "未找到 Gradle Wrapper：$gradleWrapper"
}

Write-Host "构建 $buildType APK..."
Push-Location (Join-Path $repoRoot "android")
$previousNodeEnv = $env:NODE_ENV
$previousGradleOpts = $env:GRADLE_OPTS
$env:NODE_ENV = if ($DebugBuild) { 'development' } else { 'production' }
if ($gradleJvmOptions.Count -gt 0) {
    $existingGradleOpts = if ($previousGradleOpts) { @($previousGradleOpts) } else { @() }
    $env:GRADLE_OPTS = (@($gradleJvmOptions + $existingGradleOpts) -join " ").Trim()
}
try {
    Invoke-Checked $gradleWrapper $gradleArguments
}
finally {
    $env:NODE_ENV = $previousNodeEnv
    $env:GRADLE_OPTS = $previousGradleOpts
    Pop-Location
}

$builtApk = Join-Path $repoRoot "android\app\build\outputs\apk\$buildType\app-$buildType.apk"
if (-not (Test-Path $builtApk)) {
    throw "Gradle 构建完成但未找到 APK：$builtApk"
}

$targetPath = if ([IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path $repoRoot $OutputPath
}
$targetDirectory = Split-Path -Parent $targetPath
if ($targetDirectory) {
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
}
if ($DebugBuild) {
    Copy-Item -Force $builtApk $targetPath
    Write-Host '调试包使用自动生成的 debug 签名，运行时需连接 Metro，不使用发布密钥。'
} else {
    & (Join-Path $PSScriptRoot 'sign-apk.ps1') -InputPath $builtApk -OutputPath $targetPath -KeystorePath $KeystorePath -KeyAlias $KeyAlias -AndroidSdk $androidSdk
}
$sha256 = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($targetPath)
try {
    $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
}
finally {
    $stream.Dispose()
    $sha256.Dispose()
}

Write-Host "APK 已生成：$targetPath"
Write-Host "SHA-256：$hash"

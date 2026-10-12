[CmdletBinding()]
param(
    [string]$OutputPath = "",
    [string[]]$Architectures = @(),
    [switch]$Clean,
    [switch]$DebugBuild,
    [string]$KeystorePath = (Join-Path $env:USERPROFILE 'AndroidSigning\magicmirror-release.p12'),
    [string]$KeyAlias = 'magicmirror'
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot
$packageJsonPath = Join-Path $repoRoot "package.json"

# powershell -File 会把 -Architectures a,b 当成单个字符串，PowerShell 原生调用则是数组，这里统一拆分。
$knownArchitectureGroups = @('all', 'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64')
$requestedGroups = @($Architectures | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
foreach ($requested in $requestedGroups) {
    if ($knownArchitectureGroups -notcontains $requested) {
        throw "无效的架构组 $requested，可选：$($knownArchitectureGroups -join ', ')。"
    }
}
# 发布包按架构组分别产出（App 会按设备架构选包），调试包仍是单文件。
if ($requestedGroups.Count -eq 0) {
    $requestedGroups = if ($DebugBuild) { @('arm64-v8a') } else { @('arm64-v8a', 'x86_64', 'all') }
}
if ($DebugBuild -and $requestedGroups.Count -gt 1) {
    throw "调试包一次只支持一个架构组，收到：$($requestedGroups -join ', ')。"
}
if ($requestedGroups.Count -gt 1 -and $OutputPath) {
    throw "多架构组构建不能同时指定 -OutputPath，请使用默认的 dist 命名。"
}
$Architectures = $requestedGroups

function Resolve-ReactNativeArchitectures {
    param([string]$Group)

    if ($Group -eq 'all') { return 'arm64-v8a,armeabi-v7a,x86,x86_64' }
    return $Group
}

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
$releaseVersion = (Get-Content $packageJsonPath -Raw | ConvertFrom-Json).version
if (-not $OutputPath -and $DebugBuild) {
    $OutputPath = "dist\MagicMirror-$releaseVersion-debug.apk"
}
function Get-ArtifactPath {
    param([string]$Group)

    if ($DebugBuild) { return $OutputPath }
    return Join-Path $repoRoot "dist\MagicMirror-$releaseVersion-$Group-signed.apk"
}
if (-not $DebugBuild -and -not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) {
    throw "未找到发布密钥：$KeystorePath。请使用现有密钥，或通过 -KeystorePath 指定路径。"
}

# 一次构建可能签多个架构包，密码只取一次（在建 Gradle 之前问，避免等完构建才被拦）。
$signNonInteractive = $false
$previousKeyStorePassword = $env:ANDROID_KEYSTORE_PASSWORD
$previousKeyPassword = $env:ANDROID_KEY_PASSWORD
if (-not $DebugBuild) {
    if ($env:ANDROID_KEYSTORE_PASSWORD -and $env:ANDROID_KEY_PASSWORD) {
        $signNonInteractive = $true
        Write-Host '使用 ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_PASSWORD 环境变量签名，不再提示输入。'
    } else {
        $securePassword = Read-Host '请输入发布密钥密码（同时用于密钥库与私钥）' -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $env:ANDROID_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
        $env:ANDROID_KEY_PASSWORD = $env:ANDROID_KEYSTORE_PASSWORD
        $signNonInteractive = $true
    }
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

Write-Host "构建 $buildType APK（架构组：$($Architectures -join ', ')）..."
Push-Location (Join-Path $repoRoot "android")
$previousNodeEnv = $env:NODE_ENV
$previousGradleOpts = $env:GRADLE_OPTS
$env:NODE_ENV = if ($DebugBuild) { 'development' } else { 'production' }
if ($gradleJvmOptions.Count -gt 0) {
    $existingGradleOpts = if ($previousGradleOpts) { @($previousGradleOpts) } else { @() }
    $env:GRADLE_OPTS = (@($gradleJvmOptions + $existingGradleOpts) -join " ").Trim()
}
$artifacts = @()
try {
    foreach ($group in $Architectures) {
        Invoke-Checked $gradleWrapper @($buildTask, "--no-daemon", "-PreactNativeArchitectures=$(Resolve-ReactNativeArchitectures $group)")

        $builtApk = Join-Path $repoRoot "android\app\build\outputs\apk\$buildType\app-$buildType.apk"
        if (-not (Test-Path $builtApk)) {
            throw "Gradle 构建完成但未找到 APK：$builtApk"
        }

        $targetPath = Get-ArtifactPath $group
        if (-not [IO.Path]::IsPathRooted($targetPath)) {
            $targetPath = Join-Path $repoRoot $targetPath
        }
        $targetDirectory = Split-Path -Parent $targetPath
        if ($targetDirectory) {
            New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
        }
        if ($DebugBuild) {
            Copy-Item -Force $builtApk $targetPath
        } else {
            & (Join-Path $PSScriptRoot 'sign-apk.ps1') -InputPath $builtApk -OutputPath $targetPath -KeystorePath $KeystorePath -KeyAlias $KeyAlias -AndroidSdk $androidSdk -NonInteractive:$signNonInteractive
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
        $artifacts += [pscustomobject]@{ Group = $group; Path = $targetPath; Hash = $hash }
        Write-Host "APK 已生成：$targetPath"
        Write-Host "SHA-256：$hash"
    }
}
finally {
    $env:NODE_ENV = $previousNodeEnv
    $env:GRADLE_OPTS = $previousGradleOpts
    # 签名用的密码只在本脚本运行期间存在。
    $env:ANDROID_KEYSTORE_PASSWORD = $previousKeyStorePassword
    $env:ANDROID_KEY_PASSWORD = $previousKeyPassword
    Pop-Location
}

if ($DebugBuild) {
    Write-Host '调试包使用自动生成的 debug 签名，运行时需连接 Metro，不使用发布密钥。'
}
Write-Host "共生成 $($artifacts.Count) 个 APK。"

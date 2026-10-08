[CmdletBinding()]
param(
    [string]$KeystorePath = (Join-Path $env:USERPROFILE 'AndroidSigning\magicmirror-release.p12')
)

$ErrorActionPreference = 'Stop'
$repository = 'Xuuyuan/MagicMirror'
$ghPath = (Get-Command gh -ErrorAction Stop).Source
$keyFile = (Resolve-Path -LiteralPath $KeystorePath).Path

function Set-ReleaseSecret {
    param([string]$Name, [string]$Value)
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $ghPath
    $startInfo.Arguments = "secret set $Name --repo $repository"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $process = [System.Diagnostics.Process]::Start($startInfo)
        try {
            $process.StandardInput.Write($Value)
            $process.StandardInput.Close()
            $stdoutTask = $process.StandardOutput.ReadToEndAsync()
            $stderrTask = $process.StandardError.ReadToEndAsync()
            $process.WaitForExit()
            $null = $stdoutTask.Result
            $failure = $stderrTask.Result
            if ($process.ExitCode -eq 0) {
                Write-Host "Configured $Name."
                return
            }
            # Report only a classified cause, never raw request/error data or secret values.
            $transient = $failure -match 'unexpected EOF|TLS handshake timeout|connection reset|connection refused|timed out|HTTP (502|503|504)'
            if (-not $transient) { throw "Could not configure $Name. Check GitHub login and repository permissions." }
            if ($attempt -eq 3) { throw "Could not configure $Name because the GitHub connection failed after three attempts. Retry when the network is available." }
            Write-Host "GitHub connection interrupted; retrying $Name ($attempt/3)."
        } finally { $process.Dispose() }
        Start-Sleep -Seconds (2 * $attempt)
    }
}

function Convert-SecureValue {
    param([Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceApk = Join-Path $repoRoot 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path -LiteralPath $sourceApk -PathType Leaf)) {
    throw 'Build a local release APK before configuring signing Secrets so the passwords can be verified.'
}
$previousStorePassword = $env:ANDROID_KEYSTORE_PASSWORD
$previousKeyPassword = $env:ANDROID_KEY_PASSWORD
$temporaryApk = Join-Path ([IO.Path]::GetTempPath()) ('magicmirror-sign-check-' + [guid]::NewGuid().ToString('N') + '.apk')
$storePassword = $null
$keyPassword = $null
try {
    & $ghPath auth status
    if ($LASTEXITCODE -ne 0) { throw 'Log in with gh auth login first.' }
    & $ghPath api "repos/$repository/actions/secrets/public-key" --silent
    if ($LASTEXITCODE -ne 0) { throw 'GitHub is currently unreachable or the repository cannot be accessed. Retry before entering passwords.' }
    Write-Host "Configure Android signing Secrets for $repository. Passwords are sent through stdin, never command arguments."
    $storePassword = Read-Host 'Keystore password' -AsSecureString
    $keyPassword = Read-Host 'Private key password (Enter to reuse keystore password)' -AsSecureString
    if ($storePassword.Length -eq 0) { throw 'Keystore password cannot be empty.' }
    $env:ANDROID_KEYSTORE_PASSWORD = Convert-SecureValue $storePassword
    $env:ANDROID_KEY_PASSWORD = if ($keyPassword.Length -eq 0) { $env:ANDROID_KEYSTORE_PASSWORD } else { Convert-SecureValue $keyPassword }
    & (Join-Path $PSScriptRoot 'sign-apk.ps1') -InputPath $sourceApk -OutputPath $temporaryApk -KeystorePath $keyFile -NonInteractive -ExpectedCertificateSha256 c0eb0506c4aee5f28b8c77402ea88fbf776e106a4066766ad08aec0871e5cee3
    Set-ReleaseSecret 'ANDROID_KEYSTORE_BASE64' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($keyFile)))
    Set-ReleaseSecret 'ANDROID_KEYSTORE_PASSWORD' $env:ANDROID_KEYSTORE_PASSWORD
    Set-ReleaseSecret 'ANDROID_KEY_PASSWORD' $env:ANDROID_KEY_PASSWORD
    Write-Host 'Signing verified and all three GitHub Secrets configured.'
} finally {
    $env:ANDROID_KEYSTORE_PASSWORD = $previousStorePassword
    $env:ANDROID_KEY_PASSWORD = $previousKeyPassword
    if ($storePassword) { $storePassword.Dispose() }
    if ($keyPassword) { $keyPassword.Dispose() }
    if (Test-Path -LiteralPath $temporaryApk) { Remove-Item -LiteralPath $temporaryApk -Force }
    if (Test-Path -LiteralPath "$temporaryApk.idsig") { Remove-Item -LiteralPath "$temporaryApk.idsig" -Force }
}

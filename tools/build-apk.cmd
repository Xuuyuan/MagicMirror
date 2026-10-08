@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %*
set "exitCode=%ERRORLEVEL%"
if not "%exitCode%" == "0" (
    echo APK build failed with exit code %exitCode%.
    pause
)
exit /b %exitCode%

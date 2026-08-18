@echo off
REM Type-checks @bops/api after building its workspace deps.
REM contracts/i18n must be built first: their package.json main/types point at
REM dist/, so the API cannot type-check against un-built sources.
cd /d "%~dp0..\..\.."
call npm.cmd run build --workspace @bops/contracts > "%~dp0..\tsc-check.log" 2>&1
call npm.cmd run build --workspace @bops/i18n >> "%~dp0..\tsc-check.log" 2>&1
cd /d "%~dp0.."
call node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit >> tsc-check.log 2>&1
echo TSC_EXIT=%ERRORLEVEL%

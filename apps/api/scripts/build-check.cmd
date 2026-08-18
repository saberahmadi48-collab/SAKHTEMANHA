@echo off
REM Type-checks the API after building its workspace dependencies.
REM
REM Lives in a .cmd file because PowerShell's PSReadLine mangles long commands
REM on this machine, and because `echo EXITCODE=%ERRORLEVEL%` on the SAME line
REM as the command expands BEFORE the command runs and always reports 0.
cd /d "%~dp0\..\..\.."

echo === building @bops/contracts ===
call node node_modules\typescript\bin\tsc -p packages\contracts\tsconfig.json
echo CONTRACTS_EXIT=%ERRORLEVEL%

echo === building @bops/i18n ===
call node node_modules\typescript\bin\tsc -p packages\i18n\tsconfig.json
echo I18N_EXIT=%ERRORLEVEL%

echo === type-checking @bops/api ===
cd apps\api
call node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json --noEmit
echo TSC_EXIT=%ERRORLEVEL%

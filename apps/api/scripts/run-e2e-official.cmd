@echo off
REM Runs the e2e suite through the OFFICIAL npm script, exactly as CI or a
REM teammate would. Proves `npm run test:e2e` works on its own, without the
REM hoisted-jest workaround in run-e2e.cmd.
cd /d "%~dp0.."
call npm run test:e2e > "%~dp0..\e2e-official.log" 2>&1
echo EXITCODE=%ERRORLEVEL%

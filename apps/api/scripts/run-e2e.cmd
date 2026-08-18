@echo off
REM Runs the e2e suite against the local embedded Postgres.
REM jest is hoisted to the workspace root node_modules, not apps/api.
cd /d "%~dp0.."
node "..\..\node_modules\jest\bin\jest.js" --config ./test/jest-e2e.json --runInBand %* > "%~dp0..\e2e-full.log" 2>&1
echo EXITCODE=%ERRORLEVEL%

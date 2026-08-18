@echo off
REM Verifies the official `npm run test:e2e` script resolves jest correctly.
REM --listTests only enumerates specs; it does not run them or touch the database.
cd /d "%~dp0.."
call npm run test:e2e -- --listTests
echo EXITCODE=%ERRORLEVEL%

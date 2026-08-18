@echo off
REM Creates the BM-03 finance migration and regenerates the client.
REM Written as a .cmd because PowerShell's execution policy blocks npx.ps1 and
REM PSReadLine mangles long single-line commands on this machine.
cd /d "%~dp0.."
call npx.cmd prisma migrate dev --name bm03_finance_foundation --skip-seed > migrate-bm03.log 2>&1
echo MIGRATE_EXIT=%ERRORLEVEL%

@echo off
REM Registers a hand-applied migration and regenerates the Prisma client.
REM
REM Usage: scripts\resolve-and-generate.cmd <migration_folder_name>
REM
REM `migrate resolve --applied` records the migration as done WITHOUT running it,
REM which is the only safe route on this database: `migrate dev` sees the
REM manually created invoice_number_sequences table as drift and offers only a
REM destructive reset that would drop the temporal EXCLUDE constraints.
cd /d "%~dp0.."
if "%~1"=="" (
  echo ERROR: pass the migration folder name, e.g. 20260819183000_bm03_payments
  exit /b 2
)
call npx.cmd prisma migrate resolve --applied %~1 > resolve-generate.log 2>&1
echo RESOLVE_EXIT=%ERRORLEVEL%
call npx.cmd prisma generate >> resolve-generate.log 2>&1
echo GENERATE_EXIT=%ERRORLEVEL%

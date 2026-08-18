@echo off
REM Real `nest build` for @bops/api — produces dist/ so the output can be
REM verified on disk rather than trusted from a success message.
cd /d "%~dp0\.."
call node ..\..\node_modules\@nestjs\cli\bin\nest.js build
echo NEST_EXIT=%ERRORLEVEL%

@echo off
cd /d "%~dp0..\server"
echo ==== demo %date% %time% ==== > ..\scripts\demo.log
call npx tsx scripts\canada-demo.ts >> ..\scripts\demo.log 2>&1
echo exit %errorlevel% >> ..\scripts\demo.log

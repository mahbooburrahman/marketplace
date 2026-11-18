@echo off
cd /d "%~dp0.."
call npm run test:workflows > scripts\test.log 2>&1
echo exit %errorlevel% >> scripts\test.log

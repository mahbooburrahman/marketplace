@echo off
cd /d "%~dp0.."
echo ==== setup-db %date% %time% ==== > scripts\setup-db.log
if not exist server\.env copy /y server\env.local.txt server\.env >> scripts\setup-db.log
call npm install embedded-postgres@latest -D -w server --no-audit --no-fund >> scripts\setup-db.log 2>&1
echo npm exit code %errorlevel% >> scripts\setup-db.log
echo DONE >> scripts\setup-db.log

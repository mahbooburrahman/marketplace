@echo off
cd /d "%~dp0.."
echo ==== install %date% %time% ==== > scripts\install.log
echo [pg service] >> scripts\install.log
sc query postgresql-x64-17 >> scripts\install.log 2>&1
echo [pg bin] >> scripts\install.log
dir /b "C:\Program Files\PostgreSQL\17\bin\psql.exe" >> scripts\install.log 2>&1
echo [pg_hba] >> scripts\install.log
findstr /v /r "^#" "C:\Program Files\PostgreSQL\17\data\pg_hba.conf" >> scripts\install.log 2>&1
echo [npm install] >> scripts\install.log
call npm install --no-audit --no-fund >> scripts\install.log 2>&1
echo npm exit code %errorlevel% >> scripts\install.log
echo DONE >> scripts\install.log

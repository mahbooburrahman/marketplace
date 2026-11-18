@echo off
cd /d "%~dp0.."
echo ==== check %date% %time% ==== > scripts\check.log
echo [node] >> scripts\check.log
node -v >> scripts\check.log 2>&1
echo [npm] >> scripts\check.log
call npm -v >> scripts\check.log 2>&1
echo [npm registry] >> scripts\check.log
call npm view express version >> scripts\check.log 2>&1
echo [psql] >> scripts\check.log
where psql >> scripts\check.log 2>&1
echo [postgres service] >> scripts\check.log
sc query state= all | findstr /i postgres >> scripts\check.log 2>&1
echo [docker] >> scripts\check.log
docker -v >> scripts\check.log 2>&1
echo [winget] >> scripts\check.log
winget -v >> scripts\check.log 2>&1
echo [git] >> scripts\check.log
git --version >> scripts\check.log 2>&1
echo DONE >> scripts\check.log

@echo off
cd /d "%~dp0..\server"
node scripts\create-utf8-db.mjs > ..\scripts\utf8.log 2>&1
echo exit %errorlevel% >> ..\scripts\utf8.log

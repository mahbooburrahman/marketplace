@echo off
cd /d "%~dp0.."
echo Building the website with the new SaudaGo logo. Please wait...
call npm run build -w client > scripts\build.log 2>&1
if errorlevel 1 (
  echo BUILD FAILED. Open scripts\build.log and send me the last lines.
) else (
  echo Done. Open http://localhost:4000 and press Ctrl+F5.
)
pause

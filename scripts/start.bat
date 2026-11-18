@echo off
title Marketplace (close this window to stop)
cd /d "%~dp0.."
echo Starting database, API and website... output is in scripts\dev.log
echo Open http://localhost:5173 once it says "ready".
call npm run dev:local > scripts\dev.log 2>&1

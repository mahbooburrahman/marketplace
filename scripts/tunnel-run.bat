@echo off
title Marketplace public link - close this window to stop sharing
cd /d "%~dp0.."
taskkill /im cloudflared.exe /f >nul 2>&1
echo Public link starting... the address is written to scripts\tunnel.log
tools\cloudflared.exe tunnel --no-autoupdate --logfile scripts\tunnel.log --url http://localhost:4000

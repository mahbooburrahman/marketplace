@echo off
title Marketplace public link (close this window to stop sharing)
cd /d "%~dp0.."
if not exist tools mkdir tools
if not exist tools\cloudflared.exe (
  echo Downloading cloudflared from Cloudflare...
  curl -L --fail -o tools\cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
)
echo Building the website...
call npm run build -w client
type nul >> server\src\index.ts
echo Starting public link. Look for the https://....trycloudflare.com address below.
tools\cloudflared.exe tunnel --no-autoupdate --url http://localhost:4000

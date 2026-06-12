@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
echo Iniciando SETTE Isaque Loop v2...
node --env-file=.env server.mjs
pause

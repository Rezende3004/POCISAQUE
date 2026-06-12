@echo off
cd /d "%~dp0"
if not exist ".env" copy ".env.example" ".env" >nul
echo Iniciando prova de conceito do Isaque...
node --env-file=.env server.mjs
pause

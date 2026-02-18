@echo off
REM Detener servidor Recibos App
taskkill /F /IM node.exe /FI "WINDOWTITLE eq *server.js*" >nul 2>&1
taskkill /F /IM node.exe /FI "COMMANDLINE eq *server.js*" >nul 2>&1
echo Servidor detenido
pause

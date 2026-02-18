@echo off
REM ========================================
REM DESACTIVAR INICIO AUTOMÁTICO DEL SERVIDOR
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo   DESACTIVAR INICIO AUTOMÁTICO - RECIBOS APP
echo ======================================================
echo.

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo Eliminando acceso directo de inicio automático...
echo.

REM Eliminar acceso directo si existe
if exist "%STARTUP_FOLDER%\Recibos App Servidor.lnk" (
    del "%STARTUP_FOLDER%\Recibos App Servidor.lnk" >nul 2>&1
    echo OK: Acceso directo eliminado
)

REM Eliminar script VBS si existe
if exist "%STARTUP_FOLDER%\iniciar-recibos-app.vbs" (
    del "%STARTUP_FOLDER%\iniciar-recibos-app.vbs" >nul 2>&1
    echo OK: Script eliminado
)

echo.
echo ======================================================
echo   INICIO AUTOMÁTICO DESACTIVADO
echo ======================================================
echo.
echo El servidor ya no se iniciará automáticamente.
echo.
echo Para iniciarlo manualmente, ejecuta:
echo   iniciar-servidor-silencioso.vbs
echo   O
echo   start.bat
echo.
echo ======================================================
echo.

pause

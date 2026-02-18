@echo off
REM ========================================
REM CONFIGURAR INICIO AUTOMÁTICO DEL SERVIDOR
REM Este script configura el servidor para iniciarse automáticamente
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo   CONFIGURAR INICIO AUTOMÁTICO - RECIBOS APP
echo ======================================================
echo.

REM Obtener la ruta del script actual
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

echo Directorio del proyecto: %SCRIPT_DIR%
echo.

REM Verificar que Node.js está disponible
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado o no esta en el PATH
    echo.
    pause
    exit /b 1
)

echo [1/3] Creando acceso directo en la carpeta de inicio...
echo.

REM Obtener la ruta de la carpeta de inicio del usuario
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

REM Crear el acceso directo
set "SHORTCUT_PATH=%STARTUP_FOLDER%\Recibos App Servidor.lnk"
set "TARGET_PATH=%SCRIPT_DIR%\iniciar-servidor-silencioso.vbs"

REM Usar PowerShell para crear el acceso directo
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%SHORTCUT_PATH%'); $Shortcut.TargetPath = '%TARGET_PATH%'; $Shortcut.WorkingDirectory = '%SCRIPT_DIR%'; $Shortcut.Description = 'Inicia el servidor de Recibos App automáticamente'; $Shortcut.Save()"

if %errorlevel% equ 0 (
    echo OK: Acceso directo creado en la carpeta de inicio
    echo.
    echo El servidor se iniciará automáticamente al iniciar Windows
    echo.
) else (
    echo ERROR: No se pudo crear el acceso directo
    echo.
    echo Intentando método alternativo...
    echo.
    
    REM Método alternativo: copiar el script VBS directamente
    copy "%SCRIPT_DIR%\iniciar-servidor-silencioso.vbs" "%STARTUP_FOLDER%\iniciar-recibos-app.vbs" >nul 2>&1
    if %errorlevel% equ 0 (
        echo OK: Script copiado a la carpeta de inicio
    ) else (
        echo ERROR: No se pudo configurar el inicio automático
        echo.
        echo Por favor, ejecute este script como Administrador
        pause
        exit /b 1
    )
)

echo [2/3] Verificando configuración...
echo.

REM Verificar que el archivo existe en la carpeta de inicio
if exist "%STARTUP_FOLDER%\Recibos App Servidor.lnk" (
    echo OK: Acceso directo encontrado
) else if exist "%STARTUP_FOLDER%\iniciar-recibos-app.vbs" (
    echo OK: Script encontrado en carpeta de inicio
) else (
    echo ADVERTENCIA: No se pudo verificar la configuración
)

echo.
echo [3/3] Creando script para detener el servidor...
echo.

REM Crear script para detener el servidor
(
echo @echo off
echo REM Detener servidor Recibos App
echo taskkill /F /IM node.exe /FI "WINDOWTITLE eq *server.js*" ^>nul 2^>^&1
echo taskkill /F /IM node.exe /FI "COMMANDLINE eq *server.js*" ^>nul 2^>^&1
echo echo Servidor detenido
echo pause
) > "%SCRIPT_DIR%\detener-servidor.bat"

echo OK: Script creado
echo.

echo ======================================================
echo   CONFIGURACIÓN COMPLETADA
echo ======================================================
echo.
echo El servidor se iniciará automáticamente cuando:
echo   - Inicies sesión en Windows
echo   - Reinicies tu computadora
echo.
echo Para probar ahora mismo:
echo   1. Reinicia tu computadora, O
echo   2. Ejecuta manualmente: iniciar-servidor-silencioso.vbs
echo.
echo Para detener el servidor:
echo   Ejecuta: detener-servidor.bat
echo.
echo Para desactivar el inicio automático:
echo   1. Abre: shell:startup
echo   2. Elimina: "Recibos App Servidor.lnk" o "iniciar-recibos-app.vbs"
echo.
echo ======================================================
echo.

pause

@echo off
REM ========================================
REM VERIFICAR ESTADO DEL SERVIDOR
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo   VERIFICANDO ESTADO DEL SERVIDOR
echo ======================================================
echo.

REM Verificar si hay procesos Node.js ejecutándose
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if %errorlevel% equ 0 (
    echo [ESTADO] Servidor Node.js detectado
    echo.
    
    REM Intentar hacer una petición HTTP al servidor
    echo [VERIFICACIÓN] Comprobando respuesta del servidor...
    powershell -Command "$response = try { Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; $response.StatusCode } catch { 'ERROR' }" >nul 2>&1
    
    REM Verificar usando curl si está disponible, o PowerShell
    powershell -Command "$result = try { $response = Invoke-WebRequest -Uri 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2; 'OK' } catch { 'ERROR' }; Write-Host $result" > "%TEMP%\servidor_check.txt"
    
    set /p SERVER_STATUS=<"%TEMP%\servidor_check.txt"
    del "%TEMP%\servidor_check.txt" >nul 2>&1
    
    if "!SERVER_STATUS!"=="OK" (
        echo [RESULTADO] ✅ Servidor funcionando correctamente
        echo.
        echo URL: http://localhost:3000
        echo.
        echo Puedes abrir esta URL en tu navegador ahora mismo.
    ) else (
        echo [RESULTADO] ⚠️  Proceso Node.js detectado pero no responde
        echo.
        echo El servidor puede estar iniciándose. Espera unos segundos.
        echo O puede haber un error. Revisa los logs.
    )
) else (
    echo [ESTADO] ❌ Servidor NO está ejecutándose
    echo.
    echo Para iniciar el servidor:
    echo   1. Ejecuta: iniciar-servidor-silencioso.vbs
    echo   2. O ejecuta: start.bat
    echo.
    echo Para configurar inicio automático:
    echo   Ejecuta: configurar-inicio-automatico.bat
)

echo.
echo ======================================================
echo.

timeout /t 5 >nul

@echo off
REM ========================================
REM DESCARGAR CHROMIUM - RECIBOS APP
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo     DESCARGANDO CHROMIUM PARA PUPPETEER
echo ======================================================
echo.

cd /d "%~dp0"

REM Verificar si Node.js está disponible
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado
    echo.
    pause
    exit /b 1
)

echo Descargando Chromium (esto puede tomar varios minutos)...
echo Por favor, NO cierre esta ventana...
echo.

REM Forzar descarga de Chromium
node -e "const puppeteer = require('puppeteer'); puppeteer.launch().then(browser => browser.close()).catch(e => { console.error('Error:', e.message); process.exit(1); });"

if %errorlevel% neq 0 (
    echo.
    echo ERROR: No se pudo descargar Chromium
    echo.
    echo Alternativa: Instale Google Chrome desde https://www.google.com/chrome/
    echo El servidor lo detectará automáticamente
    echo.
    pause
    exit /b 1
)

echo.
echo ======================================================
echo OK: Chromium descargado correctamente
echo.
echo Ahora puedes generar PDFs sin problemas
echo ======================================================
echo.

pause

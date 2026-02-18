@echo off
REM ========================================
REM SCRIPT DE DIAGNOSTICO - RECIBOS APP
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo      DIAGNOSTICO DEL SISTEMA - RECIBOS APP
echo ======================================================
echo.

REM 1. Verificar Node.js
echo [1] Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js NO esta instalado
    echo Descargue desde: https://nodejs.org/
) else (
    for /f "tokens=*" %%i in ('node --version') do echo OK: %%i instalado
)
echo.

REM 2. Verificar npm
echo [2] Verificando npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm NO esta disponible
) else (
    for /f "tokens=*" %%i in ('npm --version') do echo OK: %%i disponible
)
echo.

REM 3. Verificar node_modules
echo [3] Verificando node_modules...
if not exist "node_modules" (
    echo ERROR: node_modules NO existe
    echo Ejecute: install.bat
) else (
    echo OK: node_modules existe
)
echo.

REM 4. Verificar dependencias criticas
echo [4] Verificando dependencias...
if exist "node_modules\express" (
    echo OK: Express instalado
) else (
    echo ERROR: Express NO esta instalado
)
if exist "node_modules\better-sqlite3" (
    echo OK: better-sqlite3 existe
) else (
    echo ERROR: better-sqlite3 NO esta instalado
)
if exist "node_modules\puppeteer" (
    echo OK: Puppeteer instalado
) else (
    echo ERROR: Puppeteer NO esta instalado
)
echo.

REM 5. Verificar que mejor-sqlite3 funciona
echo [5] Probando mejor-sqlite3...
node -e "const db = require('better-sqlite3')(':memory:'); console.log('OK: mejor-sqlite3 funciona correctamente');" 2>nul
if %errorlevel% neq 0 (
    echo ERROR: mejor-sqlite3 NO funciona
    echo Necesita reconstruccion...
    echo.
    echo Ejecute:
    echo   npm rebuild better-sqlite3
) else (
    echo OK: mejor-sqlite3 funciona
)
echo.

REM 6. Verificar archivos del proyecto
echo [6] Verificando archivos del proyecto...
if not exist "server.js" (
    echo ERROR: Falta server.js
) else (
    echo OK: server.js existe
)
if not exist "package.json" (
    echo ERROR: Falta package.json
) else (
    echo OK: package.json existe
)
if not exist "public\index.html" (
    echo ERROR: Falta public\index.html
) else (
    echo OK: public\index.html existe
)
if not exist "public\app.js" (
    echo ERROR: Falta public\app.js
) else (
    echo OK: public\app.js existe
)
echo.

REM 7. Resumen
echo ======================================================
echo DIAGNOSTICO COMPLETADO
echo.
echo Si todos los items están OK, puede ejecutar: start.bat
echo.
echo Si hay errores:
echo   1. Ejecute install.bat nuevamente
echo   2. Si el problema persiste, reinicie la computadora
echo   3. Intente ejecutar como Administrador
echo ======================================================
echo.

pause

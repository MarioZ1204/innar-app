@echo off
REM ========================================
REM SCRIPT DE INSTALACION - RECIBOS APP
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo         INSTALACION DE RECIBOS APP
echo ======================================================
echo.

REM Verificar si Node.js está instalado
echo [1/5] Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js no esta instalado o no esta en el PATH
    echo.
    echo Descargue e instale Node.js desde: https://nodejs.org/
    echo (Version 18.0.0 o superior requerida)
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo OK: Node.js %NODE_VERSION% instalado
echo.

REM Verificar si npm está disponible
echo [2/5] Verificando npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm no esta disponible
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo OK: npm %NPM_VERSION% disponible
echo.

REM Limpiar instalación anterior (opcional)
if exist "node_modules" (
    echo [3/5] Limpiando instalacion anterior...
    rmdir /s /q node_modules >nul 2>&1
    del package-lock.json >nul 2>&1
    echo OK: Instalacion anterior limpiada
    echo.
)

REM Instalar dependencias
echo [3/5] Instalando dependencias...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Fallo la instalacion de dependencias
    echo.
    pause
    exit /b 1
)
echo.
echo OK: Dependencias instaladas
echo.

REM Limpiar cache de npm
echo [4/5] Limpiando cache y reconstruyendo modulos nativos...
call npm cache clean --force >nul 2>&1
echo.

REM Reconstruir módulos nativos - Intento 1
echo Reconstruyendo better-sqlite3 (Intento 1)...
call npm rebuild better-sqlite3 2>nul
if %errorlevel% neq 0 (
    echo Intento 1 fallido. Intentando con verbose...
    call npm rebuild better-sqlite3 --verbose
    if %errorlevel% neq 0 (
        echo.
        echo ADVERTENCIA: No se pudo compilar better-sqlite3 localmente
        echo Intentando descargar versión precompilada...
        rmdir /s /q "node_modules\better-sqlite3" >nul 2>&1
        call npm install better-sqlite3@latest --force
        if %errorlevel% neq 0 (
            echo.
            echo ERROR CRITICO: No se pudo instalar better-sqlite3
            echo.
            echo Este error puede ocurrir por:
            echo - Falta de Visual Studio Build Tools
            echo - Permisos insuficientes
            echo - Problemas de conectividad
            echo.
            echo Intente:
            echo 1. Ejecutar como Administrador
            echo 2. Reiniciar la computadora
            echo 3. Descargar Node.js LTS nuevamente desde nodejs.org
            echo.
            pause
            exit /b 1
        )
    )
)
echo.
echo OK: Modulos nativos listos
echo.

REM Verificar archivos críticos
echo [5/5] Verificando estructura del proyecto...
if not exist "server.js" (
    echo ERROR: Falta server.js
    pause
    exit /b 1
)
if not exist "public\index.html" (
    echo ERROR: Falta public\index.html
    pause
    exit /b 1
)
if not exist "package.json" (
    echo ERROR: Falta package.json
    pause
    exit /b 1
)
echo OK: Estructura del proyecto correcta
echo.

REM Verificar que better-sqlite3 funciona
echo Verificando que better-sqlite3 este funcional...
node -e "const db = require('better-sqlite3')(':memory:'); console.log('OK');" >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: mejor-sqlite3 no esta funcionando
    pause
    exit /b 1
)
echo OK: better-sqlite3 funcional
echo.

echo.
echo ======================================================
echo   OK: INSTALACION COMPLETADA EXITOSAMENTE
echo.
echo   Sistema detectado:
echo     Node.js: %NODE_VERSION%
echo     npm: %NPM_VERSION%
echo.
echo   Para iniciar el servidor ejecute: start.bat
echo   O use: npm start
echo ======================================================
echo.

pause

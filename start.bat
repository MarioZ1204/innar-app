@echo off
REM ========================================
REM SCRIPT DE INICIO - RECIBOS APP
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

echo.
echo ======================================================
echo      INICIANDO RECIBOS APP
echo ======================================================
echo.

REM Verificar si node_modules existe
if not exist "node_modules" (
    echo ERROR: Las dependencias no estan instaladas
    echo.
    echo Primero ejecute: install.bat
    echo.
    pause
    exit /b 1
)

REM Verificar que Node.js está disponible
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado o no esta en el PATH
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo OK: Node.js %NODE_VERSION% detectado
echo.

REM Verificar que better-sqlite3 está correctamente compilado
echo Verificando modulos nativos...
node -e "const db = require('better-sqlite3')(':memory:'); console.log('OK');" >nul 2>&1
if %errorlevel% neq 0 (
    echo Detectado problema con better-sqlite3
    echo.
    echo Intentando reconstruir...
    call npm rebuild better-sqlite3 >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: No se pudo reconstruir better-sqlite3
        echo.
        echo Intente ejecutar: npm rebuild better-sqlite3
        echo.
        pause
        exit /b 1
    )
    echo OK: Modulos reconstruidos exitosamente
    echo.
)

echo OK: Todos los modulos estan listos
echo.

REM Verificar si server.js existe
if not exist "server.js" (
    echo ERROR: Falta server.js
    echo.
    pause
    exit /b 1
)

echo Iniciando servidor...
echo.
echo Por favor, acceda a: http://localhost:3000
echo.
echo Para detener el servidor, presione CTRL+C
echo.
echo ======================================================
echo.

REM Iniciar el servidor
node server.js

if %errorlevel% neq 0 (
    echo.
    echo ERROR: El servidor se cerro de forma inesperada
    echo.
    pause
    exit /b 1
)

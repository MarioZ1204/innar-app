@echo off
REM ========================================
REM SCRIPT EJECUTOR - RECIBOS APP
REM Inicia servidor + navegador automáticamente
REM ========================================

setlocal enabledelayedexpansion
chcp 65001 >nul

title RECIBOS APP

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

REM Verificar que mejor-sqlite3 funciona
node -e "const db = require('better-sqlite3')(':memory:'); console.log('OK');" >nul 2>&1
if %errorlevel% neq 0 (
    echo Reconstruyendo modulos nativos...
    call npm rebuild better-sqlite3 >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: No se pudo reconstruir better-sqlite3
        echo.
        pause
        exit /b 1
    )
)

REM Verificar si server.js existe
if not exist "server.js" (
    echo ERROR: Falta server.js
    echo.
    pause
    exit /b 1
)

echo Iniciando servidor en background...
echo.

REM Iniciar servidor en background
start /B node server.js >nul 2>&1

REM Esperar a que el servidor esté listo
echo Esperando que el servidor esté listo...
timeout /t 3 /nobreak >nul

REM Abrir navegador automáticamente
echo Abriendo navegador...
start http://localhost:3000

echo.
echo ======================================================
echo OK: Servidor iniciado en http://localhost:3000
echo.
echo El navegador se abrirá automáticamente...
echo.
echo Para detener el servidor, ejecute: taskkill /F /IM node.exe
echo O cierre esta ventana y ejecute: taskkill /F /IM node.exe
echo ======================================================
echo.

REM Mantener la ventana abierta
pause

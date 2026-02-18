# ========================================
# SCRIPT EJECUTOR - RECIBOS APP
# Inicia servidor + navegador automáticamente
# ========================================

param(
    [switch]$Hidden
)

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

Write-Host ""
Write-Host "======================================================"
Write-Host "      INICIANDO RECIBOS APP"
Write-Host "======================================================"
Write-Host ""

# Verificar si node_modules existe
if (-not (Test-Path "node_modules")) {
    Write-Host "ERROR: Las dependencias no estan instaladas"
    Write-Host ""
    Write-Host "Primero ejecute: install.bat"
    Write-Host ""
    Read-Host "Presione Enter para salir"
    exit 1
}

# Verificar que Node.js está disponible
$nodeCheck = & node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Node.js no esta instalado o no esta en el PATH"
    Write-Host ""
    Read-Host "Presione Enter para salir"
    exit 1
}

# Verificar que mejor-sqlite3 funciona
$sqliteCheck = & node -e "const db = require('better-sqlite3')(':memory:'); console.log('OK');" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Reconstruyendo modulos nativos..."
    & npm rebuild better-sqlite3 > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: No se pudo reconstruir better-sqlite3"
        Write-Host ""
        Read-Host "Presione Enter para salir"
        exit 1
    }
}

# Verificar que server.js existe
if (-not (Test-Path "server.js")) {
    Write-Host "ERROR: Falta server.js"
    Write-Host ""
    Read-Host "Presione Enter para salir"
    exit 1
}

Write-Host "Iniciando servidor en background..."
Write-Host ""

# Iniciar servidor en background
$serverProcess = Start-Process -FilePath "node" -ArgumentList "server.js" -PassThru -WindowStyle Hidden -ErrorAction SilentlyContinue

# Esperar a que el servidor esté listo
Write-Host "Esperando que el servidor este listo..."
Start-Sleep -Seconds 3

# Abrir navegador automáticamente
Write-Host "Abriendo navegador..."
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "======================================================"
Write-Host "OK: Servidor iniciado en http://localhost:3000"
Write-Host ""
Write-Host "El navegador se abrira automaticamente..."
Write-Host ""
Write-Host "Para detener el servidor:"
Write-Host "  - Cierre esta ventana"
Write-Host "  - O ejecute: taskkill /F /IM node.exe"
Write-Host "======================================================"
Write-Host ""

# Mantener abierto
if (-not $Hidden) {
    Read-Host "Presione Enter para salir (esto detendrá el servidor)"
    Stop-Process $serverProcess -ErrorAction SilentlyContinue
}

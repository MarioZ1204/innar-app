# 🖥️ INSTALACIÓN EN WINDOWS SERVER

Guía paso a paso para instalar y ejecutar **Innar App** en Windows Server.

---

## ✅ Requisitos previos

Antes de empezar, asegurate de tener instalado:

| Programa | Versión mínima | Descarga |
|----------|---------------|---------|
| **Node.js** | 18.x o superior | https://nodejs.org (LTS recomendado) |
| **MySQL Server** | 5.7 o superior | https://dev.mysql.com/downloads/mysql/ o incluido en XAMPP |
| **Git** *(opcional)* | cualquiera | https://git-scm.com |

> **Verificar versiones instaladas (PowerShell):**
> ```powershell
> node --version    # Debe mostrar v18.x.x o superior
> npm --version
> mysql --version
> ```

---

## 📥 Paso 1 — Descargar el repositorio

### Opción A: Con Git (recomendado)

Abrí **PowerShell** o **Command Prompt** como **Administrador** y ejecutá:

```powershell
git clone https://github.com/MarioZ1204/innar-app.git
cd innar-app
```

### Opción B: Sin Git (descarga manual)

1. Ir a https://github.com/MarioZ1204/innar-app
2. Click en el botón verde **Code** → **Download ZIP**
3. Extraer el ZIP en una carpeta, por ejemplo: `C:\innar-app`
4. Abrir PowerShell y navegar a esa carpeta:
   ```powershell
   cd C:\innar-app
   ```

---

## ⚙️ Paso 2 — Configurar el archivo `.env`

El archivo `.env` contiene la configuración de la aplicación.

```powershell
# Copiar el archivo de ejemplo
copy .env.example .env
```

Luego abrí `.env` con el Bloc de Notas o VS Code y configurá los valores:

```env
# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=TU_CONTRASEÑA_MYSQL
DB_NAME=innar_clinica

# Servidor
PORT=3000
NODE_ENV=production
FRONTEND_URL=http://TU_IP_DEL_SERVIDOR:3000

# Secreto de sesión — generá uno aleatorio con el comando de abajo
SESSION_SECRET=CAMBIAR_POR_VALOR_ALEATORIO

# HTTPS (dejar en false para empezar)
USE_HTTPS=false

# Backups
BACKUP_DIR=./backups
MAX_BACKUPS=7
DEBUG_MODE=false
```

**Generar un SESSION_SECRET seguro:**

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copiá el resultado y pégalo como valor de `SESSION_SECRET` en el `.env`.

---

## 🗄️ Paso 3 — Crear la base de datos en MySQL

Abrí **MySQL** desde la consola (o desde XAMPP shell):

```sql
mysql -u root -p
```

Ingresá tu contraseña y ejecutá:

```sql
CREATE DATABASE IF NOT EXISTS innar_clinica CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

---

## 📦 Paso 4 — Instalar dependencias

Desde la carpeta del proyecto, ejecutá:

```powershell
npm install
```

> Esto puede tardar varios minutos la primera vez. Es normal que descargue muchos paquetes.

---

## 🔄 Paso 5 — Ejecutar migraciones de base de datos

```powershell
npm run migrate
```

Esto crea todas las tablas necesarias en la base de datos.

---

## 🚀 Paso 6 — Iniciar el servidor

```powershell
npm start
```

Si todo está bien, verás un mensaje indicando que el servidor arrancó.

Abrí tu navegador y entrá a:

```
http://localhost:3000
```

O desde otra máquina en la misma red:

```
http://IP_DEL_SERVIDOR:3000
```

> **Ver la IP del servidor:**
> ```powershell
> ipconfig
> ```
> Buscá la línea **IPv4 Address**.

---

## 🔒 Paso 7 (Opcional) — Activar HTTPS

Si necesitás conexión segura (recomendado para producción):

```powershell
# 1. Generar certificado autofirmado
node utils/generate-cert.js

# 2. En .env, cambiar:
#    USE_HTTPS=false  →  USE_HTTPS=true

# 3. Reiniciar el servidor
npm start
```

Accedé a: `https://IP_DEL_SERVIDOR:3000`

> El navegador puede mostrar advertencia de certificado — es normal para certificados autofirmados.
> Hacé click en "Continuar de todas formas" o "Aceptar riesgo".

---

## 🔄 Paso 8 (Opcional) — Ejecutar como servicio de Windows

Para que la aplicación arranque automáticamente con el servidor y siga corriendo si cerrás la sesión, podés usar **NSSM** (Non-Sucking Service Manager).

### Instalar NSSM

```powershell
# Con Chocolatey (si lo tenés instalado):
choco install nssm

# O descargarlo manualmente desde:
# https://nssm.cc/download
```

### Registrar el servicio

Abrí PowerShell como **Administrador**:

```powershell
# Reemplazá C:\innar-app con la ruta real de tu proyecto
nssm install InnarApp "C:\Program Files\nodejs\node.exe" "C:\innar-app\server.js"
nssm set InnarApp AppDirectory "C:\innar-app"
nssm set InnarApp AppEnvironmentExtra "NODE_ENV=production"
nssm set InnarApp Start SERVICE_AUTO_START

# Iniciar el servicio
nssm start InnarApp
```

### Comandos para gestionar el servicio

```powershell
nssm start InnarApp    # Iniciar
nssm stop InnarApp     # Detener
nssm restart InnarApp  # Reiniciar
nssm status InnarApp   # Ver estado
nssm remove InnarApp   # Eliminar servicio
```

---

## 🔓 Paso 9 (Opcional) — Abrir puerto en el Firewall

Si necesitás acceso desde otras máquinas o desde internet:

```powershell
# Abrir puerto 3000 (HTTP)
netsh advfirewall firewall add rule name="Innar App HTTP" dir=in action=allow protocol=TCP localport=3000

# Si usás HTTPS, también el puerto 443 (o el que configures)
netsh advfirewall firewall add rule name="Innar App HTTPS" dir=in action=allow protocol=TCP localport=443
```

---

## ✅ Verificar que todo funciona

```powershell
# 1. Ver que el servidor responde
curl http://localhost:3000

# 2. Hacer un backup manual
node utils/backup.js

# 3. Ver logs del servidor
Get-Content logs\app.log -Tail 50
```

---

## ❌ Problemas comunes

### "Cannot find module" al ejecutar `npm start`

```powershell
# Reinstalar dependencias
Remove-Item -Recurse node_modules
Remove-Item package-lock.json
npm install
```

### "Cannot connect to database"

- Verificar que MySQL está corriendo (en XAMPP: Start → MySQL)
- Verificar credenciales en `.env`
- Probar conexión: `mysql -u root -p -h localhost`

### "Port 3000 already in use"

```powershell
# Cambiar el puerto en .env:
PORT=3001

# O liberar el puerto 3000:
Get-Process | Where-Object {$_.ProcessName -eq "node"} | Stop-Process
```

### "Faltan variables de entorno"

Verificar que el archivo `.env` existe y tiene todos los campos requeridos:
`DB_HOST`, `DB_USER`, `DB_NAME`, `SESSION_SECRET`

---

## 📂 Estructura del proyecto

```
innar-app/
├── server.js          ← Backend principal
├── .env               ← Configuración (crear desde .env.example)
├── public/            ← Frontend
├── routes/            ← Rutas de la API
├── utils/
│   ├── db-mysql.js    ← Conexión a MySQL
│   ├── backup.js      ← Backup manual
│   └── logger.js      ← Logging
├── backups/           ← Backups de BD (se crea automáticamente)
├── logs/              ← Logs del servidor (se crea automáticamente)
└── docs/              ← Documentación
```

---

## 📚 Más documentación

- [INICIO.md](./INICIO.md) — Comandos rápidos
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Solución de problemas
- [BACKUPS.md](./BACKUPS.md) — Sistema de backups
- [HTTPS.md](./HTTPS.md) — Configurar HTTPS

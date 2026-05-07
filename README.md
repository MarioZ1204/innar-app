# Innar App

Sistema de gestión de agenda médica y recibos.

**Stack:** Node.js · Express · MySQL · Socket.io · Helmet.js

---

## 🚀 Instalación rápida

```powershell
# 1. Clonar el repositorio
git clone https://github.com/MarioZ1204/innar-app.git
cd innar-app

# 2. Copiar y configurar el .env
copy .env.example .env
# Editá .env con tus credenciales de MySQL

# 3. Instalar dependencias
npm install

# 4. Crear la base de datos en MySQL
# mysql -u root -p → CREATE DATABASE innar_clinica;

# 5. Ejecutar migraciones
npm run migrate

# 6. Iniciar el servidor
npm start
```

Accedé a: **http://localhost:3000**

---

## 🖥️ Instalación en Windows Server

Seguí la guía completa paso a paso:

👉 **[docs/INSTALACION-WINDOWS-SERVER.md](./docs/INSTALACION-WINDOWS-SERVER.md)**

Cubre:
- Requisitos previos (Node.js, MySQL)
- Configuración del `.env`
- Creación de la base de datos
- Instalación de dependencias
- Ejecución de migraciones
- Inicio del servidor
- Ejecución como servicio de Windows (NSSM)
- Configuración del Firewall

---

## 📚 Documentación

| Documento | Descripción |
|-----------|-------------|
| [docs/INSTALACION-WINDOWS-SERVER.md](./docs/INSTALACION-WINDOWS-SERVER.md) | Guía completa de instalación en Windows Server |
| [docs/INICIO.md](./docs/INICIO.md) | Comandos rápidos para arrancar |
| [docs/ARQUITECTURA.md](./docs/ARQUITECTURA.md) | Arquitectura del sistema |
| [docs/HTTPS.md](./docs/HTTPS.md) | Configurar HTTPS |
| [docs/BACKUPS.md](./docs/BACKUPS.md) | Sistema de backups |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Solución de problemas |
| [docs/INDEX.md](./docs/INDEX.md) | Índice completo de documentación |

---

## ⚙️ Variables de entorno

Copiá `.env.example` a `.env` y configurá:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña
DB_NAME=innar_clinica
PORT=3000
SESSION_SECRET=generar_con_crypto_randomBytes
USE_HTTPS=false
```

---

## 📜 Comandos

```powershell
npm start                    # Iniciar servidor
npm run migrate              # Ejecutar migraciones de BD
npm test                     # Ejecutar tests
node utils/backup.js         # Crear backup manual
node utils/backup.js list    # Ver backups disponibles
node utils/generate-cert.js  # Generar certificado HTTPS
```

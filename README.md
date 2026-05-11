# Innar-App

Sistema de gestión clínica para Neurociencias Nariño: agenda médica, electrodiagnóstico, recibos y reportes.

Backend Node.js (Express + Socket.IO + MySQL) sirviendo una SPA en HTML/JS/CSS.

## Stack

- Node.js 18+, Express 5, Socket.IO 4
- MySQL 5.7 / 8.x (pool con `mysql2/promise`)
- Sesiones en memoria con `express-session`
- `helmet`, CSRF (doble envío), `express-rate-limit`, Joi
- Puppeteer-core para PDF
- Front: vanilla JS/CSS, jQuery-less, CryptoJS (cliente) + bcryptjs (servidor)

## Instalación local (XAMPP + Node)

1. **Requisitos**: Node 18+, MySQL local (XAMPP, MariaDB o equivalente), Chrome/Edge para PDF.
2. **Dependencias**:
   ```bash
   npm install
   ```
3. **Configurar entorno**:
   ```bash
   copy .env.example .env
   # editar .env con DB y SESSION_SECRET
   ```
4. **Inicializar BD**:
   ```bash
   npm run migrate
   ```
5. **Arrancar en dev**:
   ```bash
   npm run dev
   ```
6. Abrir [http://localhost:3000](http://localhost:3000).

## Despliegue en Hostinger (producción)

Consulte [`docs/HOSTINGER-DEPLOY.md`](docs/HOSTINGER-DEPLOY.md) y [`.env.hostinger.example`](.env.hostinger.example).

Pasos resumidos:
1. Subir el proyecto al directorio del dominio (excepto `node_modules/`, `logs/`, `backups/`, `.env`).
2. Crear `.env` desde `.env.hostinger.example`.
3. Ejecutar `npm install --production`.
4. Verificar entorno: `npm run check:hostinger-env`.
5. Arrancar el proceso (`pm2 start server.js --name innar` o gestor del panel).
6. El `.htaccess` enruta `/api/*` y `/socket.io/*` al puerto Node.

## Scripts

| Script | Acción |
|--------|--------|
| `npm start` | Arranca producción |
| `npm run dev` | Arranca con nodemon + `.env.dev` |
| `npm test` | Ejecuta suite Jest (124 tests) |
| `npm run test:coverage` | Tests con reporte de cobertura |
| `npm run migrate` | Inicializa esquema + aplica migraciones |
| `npm run check:syntax` | Verifica sintaxis de `server.js` |
| `npm run check:hostinger-env` | Valida variables requeridas |
| `npm run build:min` | Minifica JS/CSS y optimiza imágenes (in-place) |
| `npm run build:bundle` | Empaqueta `public/js/` con esbuild |

## Operación

- **Backups**: `node utils/backup.js create` para uno manual. Ver `docs/BACKUPS.md`.
- **Restore**: ver `docs/RUNBOOK.md`.
- **Healthcheck**: `GET /api/health` (público), `GET /api/health/deep` (auth).
- **Logs**: `logs/app.log`, `logs/errors.log`, `logs/debug.log`, `logs/crashes.log`.
- **Migraciones**: tabla `schema_migrations` lleva el tracking.

## Documentación

- [`docs/INDEX.md`](docs/INDEX.md) — índice general
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operaciones (backup, restore, rate-limit, sesiones)
- [`docs/FRONTEND-REFACTOR.md`](docs/FRONTEND-REFACTOR.md) — plan de rescate del frontend
- [`docs/HOSTINGER-DEPLOY.md`](docs/HOSTINGER-DEPLOY.md) — despliegue paso a paso
- [`docs/BACKUPS.md`](docs/BACKUPS.md) — política de backups
- [`docs/TESTING.md`](docs/TESTING.md) — pruebas automáticas
- [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md) — arquitectura

## Versión

`1.3.0` — refactor estructural (extracción de `server.js`, validación Joi en rutas mutantes, IDOR cerrado, CSP_STRICT opt-in, uploads autenticados, logger async, schema_migrations).

Ver [`CHANGELOG.md`](CHANGELOG.md).

## Licencia

ISC — uso interno de la organización.

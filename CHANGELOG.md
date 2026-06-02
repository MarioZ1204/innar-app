# Changelog

Todos los cambios importantes a la aplicación se documentan aquí. El formato
sigue (informalmente) [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.5.48] — 2026-05-27

### Corregido

- **PDX 500 al abrir carpeta**: migración `rt_sop_pdx_archivos_ensure` crea `sop_pdx_archivos` si la migración inicial se saltó; consultas con varios fallbacks; filas JSON-safe; superadmin ve `detail`/`code` en el 500.

## [1.5.47] — 2026-05-27

### Corregido

- **Reportes PDX**: error 500 al listar archivos de carpeta si `periodo` inválido en BD, si falta columna `editado_por` o falla el cálculo de `nombre_descarga`. Transiciones de vista (`InvalidStateError`) mitigadas en `innar-motion.js`.

## [1.5.46] — 2026-05-27

### Corregido / añadido

- **Uploads persistentes en producción**: variable de entorno `UPLOADS_DIR` para guardar PDF fuera del repositorio (evita «Archivo no en disco» tras `git pull` / redeploy en Hostinger). Documentación en `docs/HOSTINGER-DEPLOY.md` y `.env.hostinger.example`. Health deep incluye chequeo `uploadsDir`.

## [1.5.2] — 2026-05-19

### Cambiado

- UI Soportes: textos largos de FEV/nombres canónicos eliminados en armado.
- Recibos: botón dedicado para cambiar forma de pago (Efectivo/Transferencia).
- Cache bust: subir `APP_BUILD_VERSION` o `package.json` tras deploy (`?v=1.5.2` en assets).

## [1.3.1] — 2026-05-11

Hotfix de regresiones reportadas en producción tras el deploy de 1.3.0.

### Corregido

- **Banner azul "Hay una actualización disponible" después de cada reinicio**:
  `APP_VERSION` por defecto ya no incluye `Date.now()`; usa el `version` de
  `package.json` (estable). Para forzar reload tras un deploy real, exportar
  `APP_BUILD_VERSION` o `SOURCE_VERSION` con un valor distinto al anterior. (`server.js`).
- **Toast "Sesión expirada" pocos minutos después de iniciar sesión**: las
  sesiones se persisten ahora en la tabla `app_sessions` (MySQL) vía
  `express-mysql-session`. Antes se usaba `MemoryStore`, así que cada reinicio
  del proceso Node borraba todas las sesiones activas y el cliente recibía 401
  en la siguiente petición. Para forzar `MemoryStore` (solo dev) definir
  `SESSION_STORE=memory`. (`config/session.js`).
- **Estudios de Electrodiagnóstico marcados como "Completado" prematuramente**:
  el auto-cierre del job que liberaba capacidad cerraba cualquier estudio cuya
  `hora_fin` planeada hubiera pasado, lo cual interrumpía estudios largos
  (polisomnografías) cuando la duración programada por defecto era de 30 min.
  Ahora el auto-cierre actúa SOLO sobre estudios de días anteriores que
  quedaron "En Estudio" (`routes/electro.js`).

### Dependencias

- Añadido `express-mysql-session ^3.0.3`.

## [1.3.0] — 2026-05-11

Refactor estructural mayor + endurecimiento de seguridad. Backwards-compatible
en API. Tests: 124 pasando en 11 suites.

### Seguridad

- **Auth**: nuevo `utils/password.js` que valida el hash SHA-512 hex de 128 chars
  enviado por el cliente y centraliza el `bcrypt(clientHash)` para almacenamiento.
  La validación inversa `length < 100` se reescribió como `isValidClientHash()`.
- **IDOR**: cerrado en `routes/agenda.js` (`/doctor-agenda/upload`),
  `routes/turnos.js` (5 endpoints: llamar-siguiente, marcar-atendido, PATCH estado,
  PATCH número), `routes/pacientes.js` (DELETE /pacientes-espera) y `routes/appointmentsV1.js`
  (todos los endpoints con `requireRoleOrPerm`).
- **DDL en runtime eliminado**: `routes/electro.js` ya no ejecuta `ALTER TABLE` en
  PATCH. La migración del ENUM se aplica una sola vez en `migrations/`.
- **Rate limiter**: fail-closed en errores de BD (`modules/rate-limiter.js`),
  uso consistente de `DATETIME` con `NOW() + INTERVAL`.
- **Joi**: cableado en rutas mutantes (`turnos`, `pacientes-espera`, `usuarios`,
  `electro`). Schemas `api*` alineados al modelo real exportados desde
  `modules/validation-schemas.js`.
- **Transacciones**: `services/appointmentService.js` (create+cancel con
  `FOR UPDATE`), `agenda/eliminar-dia`, `turnos/reordenar-numero`, validación
  de totales en `recibos`.
- **Errores**: `safeError` corta a 200 chars sin stacks (`middleware/index.js`).
- **Uploads**: `public/uploads/` excluido del estático; nueva ruta autenticada
  `GET /uploads/:filename` (`routes/uploads.js`) con verificación de propiedad.
  Validación de MIME real con magic bytes (`middleware/upload.js`).
- **CSP**: nueva variable `CSP_STRICT` que elimina `'unsafe-inline'` y
  `'unsafe-eval'` de `scriptSrc`. Reporting endpoint enriquecido con
  `effective-directive` y `column-number`.
- **Logger**: campos PII clínicos redactados por defecto (documento, teléfonos,
  email, paciente_*). Modo asíncrono opt-in con `LOG_ASYNC=true` (write stream
  + cola).
- **Pool MySQL**: `assertPool()` lanza error claro si se usa antes de
  `initPool()`.

### Refactor

- **`server.js`**: 1296 → 240 líneas. Extraído a:
  - `config/security.js` — Helmet + CSP + CSRF.
  - `config/session.js` — express-session + inactividad.
  - `config/static-files.js` — `express.static` único + inyección de versión.
  - `config/rate-limit.js` — limiters globales.
  - `config/cors.js` — CORS.
  - `socket/handlers.js` — Socket.IO + handlers.
  - `migrations/runtime-migrations.js` — todas las migraciones inline que vivían
    en `server.js`, ahora registradas en `schema_migrations`.
- **Multer unificado** en `middleware/upload.js` (con `validateMagicBytes`).
- **Middleware de autorización** consolidado en `middleware/index.js` (sin
  duplicación con `server.js`).
- **Frontend**: script inline del splash extraído a `public/splash.js`;
  `public/js/{state,api,ui-helpers,index}.js` como andamiaje modular para el
  rescate progresivo del `app.js` minificado;
  `validation-client.js` reescrito legible con espejo de Joi.

### Base de datos

- Nueva tabla `schema_migrations` para tracking real de migraciones.
- Migraciones añadidas: `recibos_fks_integridad` (6 FKs nuevas con limpieza de
  huérfanos), `dias_bloqueados_unique_fecha_doctor` (UNIQUE corregido).
- `scripts/preflight-patch-B.sql` — diagnóstico read-only previo al patch crítico.
- `scripts/apply-patch-B.js` — orquestador con verificación de backup reciente,
  ejecución por secciones, validación de FKs antes del dedupe de pacientes.

### Operaciones

- **Backups**: `backup-scheduler.js` simplificado, 1 backup diario por defecto
  (`BACKUP_DAILY_CRON`) + intra-día opt-in (`BACKUP_INTRA_CRON`).
- **Healthcheck profundo**: `GET /api/health/deep` (auth) verifica latencia BD,
  edad del último backup, tamaño de logs, memoria RSS.
- **Crash logs separados**: `logs/crashes.log` para `uncaughtException` y
  `unhandledRejection`.
- **`.env.hostinger.example`** documentado y diferenciado del `.env.example`.

### Tests

- 124 tests en 11 suites (antes: ~40).
- Suites añadidas: `api-schemas`, `middleware-auth`, `upload-magic-bytes`,
  `db-pool-guard`, `server-mounts`, password helpers.
- `bcrypt` → `bcryptjs` en `project-structure.test.js`.
- `transactions.test.js` con `jest.mock` correctamente posicionado.
- Cobertura ampliada a `routes/`, `middleware/`, `services/`, `config/`,
  `migrations/`.

### Documentación

- `README.md` raíz con stack, scripts, despliegue, operación.
- `docs/RUNBOOK.md` con procedimientos operacionales (backup, restore, CSP
  switchover, healthcheck, etc.).
- `docs/FRONTEND-REFACTOR.md` con plan de rescate del frontend minificado y
  procedimiento de switchover de CSP.
- `docs/archivo/` consolida changelogs y resúmenes antiguos.
- `.htaccess` con comentarios documentando el proxy.

## [1.2.x] anteriores

Ver `docs/archivo/CHANGELOG-*.md` para hitorial previo.

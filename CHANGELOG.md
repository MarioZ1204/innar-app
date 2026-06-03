# Changelog

Todos los cambios importantes a la aplicación se documentan aquí. El formato
sigue (informalmente) [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [1.5.67] — 2026-05-27

### Corregido

- **Soportes**: error al crear carpetas (PDX y armado). Lectura correcta de `insertId` tras INSERT, validación de fila creada, mensajes claros si faltan tablas de migración o permisos en `UPLOADS_DIR`.

## [1.5.66] — 2026-05-27

### Corregido

- **Electrodiagnóstico**: al agendar un estudio nuevo ya no se auto-completa el que está En Estudio; el cierre automático del día actual exige `duracion_minutos` (inicio + duración), no el slot corto de `hora_fin`.

## [1.5.65] — 2026-05-27

### Corregido

- **Electrodiagnóstico**: error 500 en `GET /api/citas-electro` por SQL inválido (alias vacío en sincronización de duraciones).

## [1.5.65] — 2026-05-27

### Corregido

- **Electrodiagnóstico**: error 500 en `GET /api/citas-electro` (kanban vacío). La reparación al cargar citas ya no rompe la petición si falla el SQL; se evita `TRIM` sobre columnas TIME y el UPDATE de reversión solo cambia el estado.

## [1.5.64] — 2026-05-27

### Corregido

- **Electrodiagnóstico**: citas que seguían en Completado con fin programado futuro (p. ej. monitorización 6 h). Al cargar el kanban o el monitor se reparan duraciones faltantes y se revierten a En Estudio; el auto-cierre solo aplica cuando el fin programado real ya venció (no por slot corto sin `duracion_minutos`).

## [1.5.63] — 2026-05-27

### Corregido

- **Recibos — filtros de reportes**: tipos de consulta y estudio se cargan desde `/api/recibos/opciones` según médico/especialidad; filtros separados (`tipo_consulta` / `tipo_estudio`). Valores en recibos que no están en el catálogo aparecen bajo **Otros**.

## [1.5.62] — 2026-05-27

### Corregido

- **Electro**: reversión al arranque de citas marcadas Completado cuando el fin programado aún no venció (no solo `Sistema (Auto)`).
- **Auditoría de citas**: filtro de médico con selección múltiple; tipos de consulta unidos de todas las especialidades de los médicos elegidos.

## [1.5.61] — 2026-05-27

### Corregido

- **Electrodiagnóstico**: estudios que pasaban solos a Completado al iniciar (fin programado en el pasado o auto-cierre del mismo día). El auto-cierre solo aplica a días anteriores; al iniciar se recalcula `hora_fin` desde la hora efectiva; migración devuelve a En Estudio los de hoy cerrados por `Sistema (Auto)`.

## [1.5.60] — 2026-05-27

### Mejorado

- **Cargar reportes**: subida flexible por campos mínimos (no exige el nombre perfecto). Detecta apellidos, nombres y fecha aunque falten guiones o comas; solo pide lo que falte en un formulario con etiquetas «Detectado» / «Complete».
- Pre-análisis en servidor (`POST .../pre-analizar`) y un solo modal de confirmación para todas las carpetas (VTM, EEG, PSG, órdenes, comprobantes, consentimientos).

## [1.5.59] — 2026-05-27

### Cambiado

- **Soportes**: se quitó el slot CNS; los consentimientos no se vinculan al armado (solo en Cargar reportes).

## [1.5.58] — 2026-05-27

### Corregido

- **Enlazar PDX / importar desde reportes**: error 500 al copiar el PDF (fallo `rename` entre discos en Windows). Ahora usa copia segura al guardar en el expediente.

### Añadido

- **Vincular desde reportes** por tipo: reporte → PDX, comprobante → CRC, ORDEN+HC → enlace en carpeta FE (luego «Generar OPF»). Los consentimientos permanecen solo en Cargar reportes.
- Endpoint `POST .../importar-deposito` (alias de `importar-pdx`).
- Tabla `sop_exp_vinculos` para órdenes vinculadas.

### Cambiado

- **Armado de soportes**: explorador con tarjetas de carpetas (mes → días → RIPS/SOPORTES → FE) en el panel principal; el mes sigue en la barra lateral.

## [1.5.57] — 2026-05-27

### Añadido

- **Armado — Generar OPF**: botón en el slot OPF para unir el PDF **ORDEN+HC** del depósito de reportes con la **autorización** subida en el expediente (`POST /api/soportes/armado/expedientes/:id/generar-opf`). Nombre canónico `OPF_{NIT}_FE{n}.pdf`; requiere FEV/número de factura; bloquea si ya existe OPF.

### Cambiado

- **Armado**: ya no se puede subir OPF manualmente; usar «Generar OPF». Búsqueda de ORDEN+HC en carpetas de órdenes (`GET /api/soportes/pdx/buscar-ordenes`).

## [1.5.56] — 2026-06-02

### Corregido

- **Ver Recibos**: los filtros del reporte ya no se pierden cuando otro usuario cambia agenda, electro u otro módulo (el tiempo real recargaba `cargarLista()` sin parámetros).

## [1.5.55] — 2026-06-02

### Añadido

- **Recibos (solo superadmin)**: botón para cambiar el usuario que generó un recibo (`PATCH /api/recibos/:id/generador`), actualiza `generado_por_id` y `generado_por_nombre` en BD.

### Corregido

- **Contador diario en Nuevo Recibo**: ya no se sobrescribe con la lista filtrada de «Ver recibos»; usa `GET /api/recibos/stats-hoy` con fecha local; sockets llaman `updateSavedCount` en lugar de vaciar el contador.

## [1.5.54] — 2026-06-02

### Corregido

- **Filtro recibos — Especialidad**: el desplegable no cargaba opciones desde `/api/especialidades` (solo quedaba «Todas»).

### Añadido

- **Reportes PDX**: búsqueda de pacientes predictiva al escribir (debounce 320 ms), además de Enter/botón Buscar.
- **Armado de soportes**: buscador de pacientes en la barra superior con resultados en vivo y navegación al expediente (`GET /api/soportes/armado/buscar`).

## [1.5.53] — 2026-06-02

### Corregido

- **Subida PDX**: faltaba `require('fs')` en `middleware/upload.js` (validación PDF fallaba siempre con «No se pudo validar el archivo subido»).
- **Filtros recibos**: bucle infinito entre multiselect tipo consulta / estudio (`silentClearMultiSelect`).

## [1.5.52] — 2026-06-02

### Corregido

- **Subida PDX 500**: el PDF ya no se renombra en disco en reportes PSG/VTM/EEG (se conserva el nombre de multer); `ruta_relativa` siempre coincide; INSERT con límites de longitud y `insertId` bigint; errores con `detail` y `step`.

## [1.5.51] — 2026-06-02

### Corregido

- **PDX ver/descargar 404**: resolución de PDF sin cachear `UPLOADS_DIR`, coincidencia con nombres multer (`1234-archivo.pdf`), rutas legacy `public/uploads` y reparación de `ruta_relativa` en BD al abrir.
- **POST subida PDX**: `ruta_relativa` alineada al archivo real en disco; health deep 200 aunque falten backups.

## [1.5.50] — 2026-05-27

### Corregido / añadido

- **Diagnóstico login/sesión 500**: `GET /api/health/db` (ping MySQL), manejo de errores de sesión y rate-limit fail-open si falla `login_attempts`.

## [1.5.49] — 2026-05-27

### Corregido

- **Subida PDX (POST) 500**: multer con errores legibles, ruta real del PDF tras `UPLOADS_DIR`, nombres en disco acotados, INSERT con columnas legacy y migración de columnas faltantes; superadmin ve `detail` en el error.

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

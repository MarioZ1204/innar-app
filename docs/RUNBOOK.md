# Runbook operacional — Innar-App

Procedimientos para administrar la aplicación en producción. Lea [`HOSTINGER-DEPLOY.md`](HOSTINGER-DEPLOY.md) para la configuración inicial.

## 1. Backups

### 1.1 Crear backup manual

```bash
node utils/backup.js create
```

Sale en `backups/innar_clinica_YYYY-MM-DD_HH-MM-SS.sql`. Verifica al final con `mysqldump --check`.

### 1.2 Listar backups

```bash
node utils/backup.js list
```

### 1.3 Restaurar backup

**Ventana de mantenimiento sugerida**: 30 min.

```bash
# 1. Detener app
pm2 stop innar

# 2. Crear backup de seguridad ANTES de restaurar
node utils/backup.js create

# 3. Importar
mysql -h <host> -u <user> -p innar_clinica < backups/<archivo>.sql

# 4. Re-iniciar
pm2 start innar

# 5. Verificar healthcheck
curl http://localhost:3000/api/health/deep
```

### 1.4 Política

Configurable vía env:
- `BACKUP_DAILY_CRON` (default `0 2 * * *` — 02:00 AM diario)
- `BACKUP_INTRA_CRON` (opcional — sin valor, no se ejecutan backups intra-día)
- `MAX_BACKUPS=14` — conservar 14 días.

## 2. Migraciones de BD

```bash
npm run migrate
```

Las migraciones se registran en `schema_migrations`. Las que ya están aplicadas se omiten automáticamente.

Para aplicar el patch crítico de integridad (Ñ corruptas, FKs faltantes, dedupe de pacientes):

```bash
# 1. Backup completo
node utils/backup.js create

# 2. Pre-flight diagnóstico
mysql -h <host> -u <user> -p innar_clinica < scripts/preflight-patch-B.sql

# 3. Aplicar por secciones
node scripts/apply-patch-B.js --section 1
node scripts/apply-patch-B.js --section 2
# ... (revisar resultado tras cada sección)

# o todo de una vez (si los preflights se ven OK)
node scripts/apply-patch-B.js --all
```

El `apply-patch-B.js` verifica que exista backup reciente (<24 h) antes de proceder.

## 3. Rate limiter

Bloqueos por IP/usuario tras intentos fallidos de login (`login_attempts` tabla, `modules/rate-limiter.js`).

### Ver estado de un IP/usuario

```sql
SELECT * FROM login_attempts WHERE ip_address = '?' ORDER BY attempt_time DESC LIMIT 20;
SELECT * FROM rate_limit_blocks WHERE (ip_address = '?' OR identifier = '?') AND bloqueado_hasta > NOW();
```

### Desbloquear

```sql
DELETE FROM rate_limit_blocks WHERE ip_address = '?' OR identifier = '?';
```

### Whitelist permanente

Variable de entorno:
```
RATE_LIMIT_TRUSTED_IPS=190.123.4.5,200.45.66.7
```

## 4. Sesiones

### Forzar logout de un usuario

Las sesiones viven en memoria; basta con reiniciar el proceso.

```bash
pm2 restart innar
```

Para invalidar sin reiniciar, ejecute desde la base de datos (si se migró a session-store en BD).

## 5. Logs

| Archivo | Contenido | Rotación |
|---------|-----------|----------|
| `logs/app.log` | Eventos generales (info, warn, error, api) | A 10 MB → `.1.log` → `.2.log` → `.3.log` |
| `logs/errors.log` | Solo `error()` | Idem |
| `logs/debug.log` | Solo si `DEBUG_MODE=true` | Idem |
| `logs/crashes.log` | `uncaughtException` y `unhandledRejection` | Manual |
| `logs/startup-error.log` | Errores de arranque | Manual |

### Ver últimas líneas

```bash
node -e "console.log(require('./utils/logger').getTail('logs/app.log', 50).join('\n'))"
# o simplemente
type logs\app.log | Select-Object -Last 50
```

### Limpiar logs

`utils/logger.cleanOldLogs()` se ejecuta automáticamente al arrancar y rota los archivos > 10 MB.

## 6. CSP — switchover a estricto

Estado por defecto: `CSP_REPORT_ONLY=true`, `CSP_STRICT=false`.

1. Verificar `logs/app.log` por entradas `[CSP] Violación reportada` durante 48 h.
2. Si **0 violaciones**: cambiar `.env`:
   ```
   CSP_REPORT_ONLY=false
   ```
   Reiniciar.
3. Para eliminar `'unsafe-inline'`/`'unsafe-eval'` de `scriptSrc`: ver [`FRONTEND-REFACTOR.md`](FRONTEND-REFACTOR.md), luego `CSP_STRICT=true`.

## 7. Healthcheck profundo

```bash
curl -b cookies.txt -c cookies.txt http://localhost:3000/api/health/deep
```

Devuelve `503` si DB no responde, no hay backups recientes, o disco/logs presentan errores.

Campos útiles:
- `checks.db.latency_ms` — alerta si > 200 ms sostenido.
- `checks.backupsDir.latestAgeHours` — alerta si > 30 h (debería haber backup diario).
- `checks.process.memRss_mb` — alerta si > 800 MB.

## 8. Despliegue de nueva versión

```bash
# 1. Pull
git pull

# 2. Dependencias (si package.json cambió)
npm install --production

# 3. Migraciones
npm run migrate

# 4. Reinicio cero-downtime con pm2
pm2 reload innar

# 5. Verificar
curl http://localhost:3000/api/version
curl http://localhost:3000/api/health
```

## 9. Variables de entorno críticas

| Variable | Producción | Notas |
|----------|------------|-------|
| `NODE_ENV` | `production` | Activa HSTS, redacta errores |
| `SESSION_SECRET` | 48+ bytes hex | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `SESSION_COOKIE_SECURE` | `true` | Detrás de Apache+HTTPS |
| `LOG_ASYNC` | `true` | Escritura no-bloqueante de logs |
| `RATE_LIMIT_TRUSTED_IPS` | IPs de la sede | Evita bloqueo de la red interna |
| `BACKUP_DAILY_CRON` | `0 2 * * *` | 02:00 AM |
| `CSP_ENABLED` | `true` | Helmet CSP |
| `CSP_REPORT_ONLY` | `true` inicialmente | Cambiar a `false` cuando 0 violaciones |

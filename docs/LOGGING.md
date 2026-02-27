# Sistema de Logging Centralizado

## Resumen

Se ha implementado un sistema de logging robusto que captura:
- **Requests HTTP** - Método, ruta, código de estado, duración
- **Transacciones BD** - Commits, rollbacks, errores
- **Eventos de Sistema** - Info, warnings, errores, debug
- **Performance** - Medición de tiempos de ejecución

## Características

### 📊 Niveles de Log
```javascript
logger.info(message, data)       // Información general
logger.error(message, data)      // Errores (en errors.log + app.log)
logger.warn(message, data)       // Advertencias
logger.debug(message, data)      // Debug (con DEBUG_MODE=true)
logger.success(message, data)    // Operaciones exitosas
logger.api(method, path, status, duration) // Requests HTTP
```

### 📁 Archivos de Log
```
logs/
├── app.log          # Log principal (todos los eventos)
├── errors.log       # Solo errores
├── debug.log        # Solo debug (si DEBUG_MODE=true)
└── *.YYYY-MM-DD.log # Backups rotados automáticamente (>50MB)
```

### 🎨 Colores en Terminal
```
ℹ Azul     - Info
✓ Verde    - Success
⚠ Amarillo - Warnings
✗ Rojo     - Errores
🐛 Cyan    - Debug
```

### ⏱️ Formato
```
[ISO_TIMESTAMP] [LEVEL] message | {"data": "context"}
```

## Ejemplo de Uso

### Logging Básico
```javascript
const logger = require('./utils/logger');

// Info
logger.info('Usuario conectado', { userId: 123, email: 'user@example.com' });

// Error (se escribe en errors.log + app.log)
logger.error('Falló la transacción', { error: 'Duplicate entry', code: 'ERR_DUP' });

// Warning
logger.warn('Base de datos lenta', { queryTime: '2500ms' });

// Success
logger.success('Cita creada correctamente', { citaId: 42, duration: '250ms' });
```

### Logging de Requests HTTP
El middleware en `server.js` registra automáticamente todos los requests:
```
→ GET     /api/citas                            200 45ms
→ POST    /api/citas-electro                    201 128ms
→ DELETE  /api/citas/42                         204 32ms
```

### Logging de Transacciones
Las transacciones se registran automáticamente:
```javascript
const result = await transactions.withTransaction(async (conn) => {
  // Tu código aquí
}, 'Crear nueva cita');

// En logs/app.log:
// [2026-02-27T...] [DEBUG] START Transaction: Crear nueva cita
// [2026-02-27T...] [SUCCESS] COMMIT: Crear nueva cita | {"duration": "45ms"}
```

### Debug Mode
Para activar logs de debug en `.env`:
```env
DEBUG_MODE=true
```

## Integración con Express

El middleware está activo en `server.js` a partir de la línea ~65:
```javascript
// 📊 Middleware de logging para requests/responses
app.use((req, res, next) => {
  // Captura automática de requests/responses
  // Duration en ms
  // Status code
  // IP del usuario
});
```

## Rotating Logs

Los logs se rotan automáticamente cuando superan 50MB:
- Se renombra a `app.YYYY-MM-DD.log`
- Se crea nuevo `app.log` vacío
- Se registra la rotación en `app.log`

## Lectura de Logs

### Últimas N líneas
```javascript
const tail = logger.getTail(/* pathOptional */, 100);
console.log(tail);
```

### Terminal (en tiempo real)
```bash
# Monitorear logs en vivo
tail -f logs/app.log

# Solo errores
tail -f logs/errors.log

# Buscar errores específicos
grep "ERROR" logs/app.log
grep "transaction" logs/app.log | grep -i "rollback"
```

## Limpiar Logs Antiguos

```bash
# Borrar archivos .rotated de más de 30 días
find logs -name "*.YYYY-MM-*.log" -mtime +30 -delete

# O manualmente
del logs\*.2026-01-*.log
```

## Mejoras Futuras

- [ ] Envío de logs a servicio externo (AWS CloudWatch, Sentry)
- [ ] Alertas automáticas para errores críticos
- [ ] Dashboard de logs en tiempo real
- [ ] Búsqueda de logs por fecha/nivel/mensaje
- [ ] Compresión automática de logs antiguos

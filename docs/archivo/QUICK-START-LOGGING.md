# 🔧 QUICK START - Logging & Testing

## 5 Minutos para Empezar

### 1. Ver logs en tiempo real
```powershell
# Terminal PowerShell
Get-Content logs\app.log -Wait

# O buscar errores específicos
Select-String "ERROR" logs\app.log | Select-Object -Last 20
```

### 2. Ejecutar tests (debe pasar 32 tests)
```bash
npm test
```

**Resultado esperado:**
```
✓ 32 passed
✓ Test Suites: 4 passed, 4 total
✓ Time: 3.568 s
```

### 3. Agregar logging en tu código
```javascript
const logger = require('./utils/logger');

// En cualquier función
logger.info('Acción realizada', { 
  userId: 123, 
  action: 'create_cita' 
});

// En error
logger.error('Algo falló', { 
  error: err.message,
  code: 'ERR_TRANSACTION' 
});
```

### 4. Ver últimos N logs
```javascript
const logger = require('./utils/logger');
const recent = logger.getTail(undefined, 50); // Últimas 50 líneas
console.log(recent);
```

### 5. Activar debug mode
```bash
# En .env
DEBUG_MODE=true

# Luego ejecutar servidor
npm start

# Buscar debug logs
Select-String "\[DEBUG\]" logs\debug.log | Select-Object -Last 50
```

---

## Archivos Log

```
logs/
├── app.log          ← Todo (info, warn, error, success, api)
├── errors.log       ← Solo errores
├── debug.log        ← Solo debug (si DEBUG_MODE=true)
└── *.YYYY-MM-DD.log ← Backups cuando pasan 50MB
```

---

## Tests Disponibles

| Archivo | Qué testa | Comando |
|---------|-----------|---------|
| logger.test.js | Logger funciona | `npm test -- logger` |
| transactions.test.js | BD transactions | `npm test -- transactions` |
| security.test.js | Headers de seguridad | `npm test -- security` |
| project-structure.test.js | Estructura OK | `npm test -- project-structure` |

---

## Casos de Uso Comunes

### Caso 1: "Necesito ver qué pasó en el server"
```bash
# Ver últimas 20 líneas de log
Get-Content logs\app.log -Tail 20

# Ver en vivo
Get-Content logs\app.log -Wait

# Buscar errores en rango de horas
Select-String "2026-02-27T10" logs\errors.log
```

### Caso 2: "Quiero confirmar que mis cambios no rompieron nada"
```bash
npm test

# Debería ver: Tests: 32 passed, 32 total ✓
```

### Caso 3: "Necesito debuggear una transacción lenta"
```env
# En .env
DEBUG_MODE=true
```

```bash
# Entonces ejecuta
npm start

# Busca logs de esa transacción
Select-String "COMMIT\|ROLLBACK" logs\app.log
```

### Caso 4: "Quiero ver todos los requests HTTP"
```bash
Select-String "HTTP\|→" logs\app.log | Select-Object -Last 30
```

---

## Niveles de Log y Cuándo Usarlos

| Nivel | Uso | Ejemplo |
|-------|-----|---------|
| **info** | Eventos normales | `logger.info('Usuario conectado', {user})` |
| **warn** | Advertencias no críticas | `logger.warn('Query lenta', {time: '2500ms'})` |
| **error** | Errores que capturaste | `logger.error('Transacción falló', {err})` |
| **success** | Operación exitosa | `logger.success('Cita guardada', {citaId: 42})` |
| **api** | Requests HTTP | Automático en middleware |
| **debug** | Información extra (solo si DEBUG_MODE=true) | `logger.debug('Variables', {state})` |

---

## Troubleshooting

### "npm test no funciona"
```bash
# Limpiar caché
npm test -- --clearCache

# Reinstalar jest
npm install --save-dev jest
npm test
```

### "Los logs no se guardan"
```bash
# Verificar que existe carpeta logs/
Test-Path logs
# True? OK. False? Crear:
mkdir logs
```

### "No veo debug logs aunque DEBUG_MODE=true"
```bash
# Asegúrate que está en .env (no solo en terminal)
cat .env | grep DEBUG_MODE

# Debe mostrar: DEBUG_MODE=true
```

### "Los logs pesan más de 50MB"
Automáticamente se rotan (no hagas nada, sucede solo):
```
app.log           → app.2026-02-27.log (backup)
app.log (nuevo)   → archivo vacío nuevo
```

---

## Scripts Disponibles

```bash
npm start              # Iniciar servidor (con logging)
npm test              # Todos los tests
npm run test:watch   # Tests en modo watch (se re-ejecutan al guardar)
npm run test:coverage # Ver qué líneas son testeadas
```

---

## 📚 Documentación Completa

- **Logging:** `docs/LOGGING.md`
- **Testing:** `docs/TESTING.md`
- **Changelog:** `docs/CHANGELOG-LOGGING-TESTING.md`

---

## ⏱️ Comando Favorito (30 segundos para verificar todo)

```bash
# Terminal PowerShell
npm test; echo "✓ Todos los tests pasaron"

# Si pasa 32 tests ✓ = Sistema OK
```

¡Listo! 🚀

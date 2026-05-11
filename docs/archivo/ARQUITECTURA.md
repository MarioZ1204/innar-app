# 🏗️ ARQUITECTURA

## Componentes principales

### 1. Transacciones (`utils/transactions.js`)
```javascript
// Uso:
const result = await transactions.withTransaction(async (conn) => {
  await conn.execute('INSERT INTO citas_electro ...');
  await conn.execute('UPDATE equipos_electro ...');
  return { ok: true };
});
// Si algo falla → ROLLBACK automático
```

**Endpoints protegidos:**
- `POST /api/citas-electro` - Crea cita + valida capacidad atómicamente
- Otros endpoints pueden envolversen fácilmente

**Beneficio:** Nunca hay estado inconsistente en BD

---

### 2. Backups (`utils/backup.js` + `utils/backup-scheduler.js`)

**Automático:**
- Diario a las 2:00 AM
- Cada 6 horas (0, 6, 12, 18)
- Retención: últimos 7 backups
- Limpieza automática

**Manual:**
```bash
node utils/backup.js              # Crear ahora
node utils/backup.js list        # Ver disponibles
mysql -u root innar_clinica < backups/backup-*.sql  # Restaurar
```

**Archivos:**
```
backups/
├── backup-innar_clinica-2024-01-15-14-30-45.sql
├── backup-innar_clinica-2024-01-14-14-30-22.sql
└── ... (mantiene 7)
```

---

### 3. Logging (`utils/logger.js`)

**Automático en cada evento:**
```
logs/
├── app.log      ← Eventos normales
└── errors.log   ← Solo errores
```

**Ver logs:**
```bash
Get-Content logs/app.log -Tail 50
```

---

### 4. Seguridad HTTP (Helmet.js en `server.js`)

**Headers automáticos:**
```
X-Frame-Options: DENY                    ← No iframe
X-Content-Type-Options: nosniff        ← No sniffing
X-XSS-Protection: 0                    ← XSS filter
Content-Security-Policy: ...           ← Control recursos
Strict-Transport-Security: ...         ← HTTPS obligatorio
Referrer-Policy: strict-origin-...     ← Privacy
```

**Protege contra:**
- Clickjacking
- MIME sniffing  
- XSS básico
- Inyección de scripts

---

### 5. HTTPS (`server.js` + `utils/generate-cert.js`)

**Configuración:**
```
.env
├── USE_HTTPS=false    ← Cambiar a true
├── DB_HOST=localhost
├── DB_PORT=3306
└── ...

server.crt            ← Certificado (generado por script)
server.key            ← Clave privada (generado por script)
```

**Flujo:**
1. Si `USE_HTTPS=true` y existen `server.crt` + `server.key`
2. Servidor arranca en HTTPS
3. HTTP → HTTPS redirige automáticamente
4. Si `USE_HTTPS=false` → HTTP simple

---

## Carpetas importantes

```
innar-app/
├── utils/
│   ├── transactions.js      ← Transacciones ACID
│   ├── backup.js            ← Backup manual
│   ├── backup-scheduler.js  ← Backup automático
│   ├── logger.js            ← Logging
│   ├── generate-cert.js     ← Generador HTTPS
│   └── db-mysql.js          ← Pool MySQL
├── public/                  ← Frontend
├── backups/                 ← Backups de BD (auto-creada)
├── logs/                    ← Logs de servidor (auto-creada)
├── docs/                    ← Esta documentación
├── server.js                ← Backend principal
├── .env                     ← Configuración
└── package.json            ← Dependencias
```

---

## Flujo de datos

### Crear cita (con transacción):
```
Cliente → POST /api/citas-electro
           ↓
         BEGIN TRANSACTION
           ├─ Validar capacidad (SELECT FOR UPDATE)
           ├─ Insertar cita si hay espacio
           └─ COMMIT/ROLLBACK
           ↓
         Socket.io → Actualizar UI
           ↓
         Backup scheduler → Respaldo en backups/
```

### Backup automático:
```
2:00 AM / Cada 6h → node-schedule inicia
                  ↓
               mysqldump
                  ↓
            backups/backup-*.sql
                  ↓
            Limpiar antiguos (>7)
                  ↓
            Registrar en logs/app.log
```

---

## Stack tecnológico

```
Frontend:          Vanilla JS + Socket.io
Backend:           Node.js/Express
Base de datos:     MySQL con pool
Seguridad:         Helmet.js + HTTPS
Transacciones:     MySQL InnoDB ACID
Backups:           mysqldump
Scheduling:        node-schedule
```

---

## Performance

- **Transacciones:** <100ms típico
- **Backup:** 5-30 seg según tamaño
- **Helmet.js:** <1ms overhead
- **HTTPS:** ~2-5ms más que HTTP

---

Ver [HTTPS.md](./HTTPS.md) para configurar certificados.

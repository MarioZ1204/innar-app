# 📦 SISTEMA DE BACKUPS

## Automático (sin hacer nada)

El servidor crea backups automáticamente:
- **Diariamente** a las 2:00 AM
- **Cada 6 horas**: 0:00, 6:00, 12:00, 18:00
- **Retención:** Mantiene últimos 7 backups (1 semana)
- **Limpieza:** Elimina automáticamente los más viejos

Los backups se guardan en:
```
backups/
├── backup-innar_clinica-2024-01-15-14-30-45.sql
├── backup-innar_clinica-2024-01-14-14-30-22.sql
└── ... (máximo 7 archivos)
```

---

## Manual

### Crear backup ahora
```bash
node utils/backup.js
```

**Output:**
```
✅ Backup creado: backup-innar_clinica-2024-01-15-14-30-45.sql (25.5 MB)
✅ Manteniendo últimos 7 backups
```

### Ver backups disponibles
```bash
node utils/backup.js list
```

**Output:**
```
📋 Backups disponibles:
  1. backup-innar_clinica-2024-01-15-14-30-45.sql (25.5 MB) - 15/01/2024 14:30
  2. backup-innar_clinica-2024-01-14-14-30-22.sql (24.8 MB) - 14/01/2024 14:30
  3. backup-innar_clinica-2024-01-13-14-29-58.sql (24.6 MB) - 13/01/2024 14:30
  ...
```

---

## Restauración

### Desde backup SQL

```bash
# Restaurar en base de datos existente
mysql -u root -p innar_clinica < backups/backup-innar_clinica-2024-01-15-14-30-45.sql

# Se pedirá contraseña:
# Enter password: [ingresa tu contraseña de root]

# Resultado esperado:
# Query OK, X rows affected (X.XXs)
```

### Verificar que funcionó
```bash
mysql -u root -p -e "SELECT COUNT(*) as citas FROM innar_clinica.citas_electro;"
```

---

## Monitoreo

### Ver que los backups se están ejecutando

Revisar logs:
```bash
Get-Content logs/app.log | Select-String "Backup"
```

Ejemplos de salida:
```
[2024-01-15T02:00:00.000Z] INFO: Creando backup...
[2024-01-15T02:00:15.000Z] INFO: ✅ Backup automático completado exitosamente
```

### Alertas sobre backups

Si ves errores en logs:
```bash
Get-Content logs/errors.log | Select-String "backup"
```

---

## Tamaño de backups

| Situación | Tamaño típico | Tiempo |
|-----------|--------------|--------|
| Base vacía | 100 KB | <1s |
| 100 citas | 500 KB | 1-2s |
| 1000 citas | 2-3 MB | 3-5s |
| 10000 citas | 20-30 MB | 10-15s |

---

## Problemas comunes

### "Espacio en disco insuficiente"
```bash
# Ver espacio en disco
dir C:\

# Si hay poco espacio, podés:
# 1. Aumentar renta a 3 backups (MAX_BACKUPS=3 en .env)
# 2. Comprimir backups antiguos
# 3. Copiar a USB/cloud
```

### "Backup no entra en carpeta"
```bash
# Ver tamaño de carpeta backups/
dir backups/ /s /b

# Si es muy grande:
# - Mover backups a otra carpeta
# - O configurar BACKUP_DIR en .env a otra ruta
```

### "mysqldump no encontrado"
```bash
# Si está en XAMPP:
C:\"Program Files"\xampp\mysql\bin\mysqldump.exe

# O agregar a PATH en .env:
# MYSQLDUMP_PATH=C:\xampp\mysql\bin\mysqldump.exe
```

---

## Copiar a almacenamiento externo

### Semanal via PowerShell
```powershell
# Crear carpeta en USB
New-Item -Path "E:\innar-backups\$(Get-Date -Format 'yyyy-MM-dd')" -ItemType Directory -Force

# Copiar archivos
Copy-Item -Path "backups\*" -Destination "E:\innar-backups\$(Get-Date -Format 'yyyy-MM-dd')" -Force

# Resultado:
# E:\innar-backups\2024-01-15\backup-*.sql
```

### O cloud (Google Drive / OneDrive)
1. Copiar carpeta `backups/` a Google Drive
2. O automatizar con rclone:
```bash
rclone copy backups/ drive:innar-backups/
```

---

## Recovery Point Objective (RPO)

**Máximo datos perdidos:** 6 horas  
**Mínimo:** 0 horas (si haces backup manual antes de error)

**Recomendación:** Hacer backup manual antes de cambios importantes
```bash
node utils/backup.js
```

---

Ver [INICIO.md](./INICIO.md) para comandos rápidos.

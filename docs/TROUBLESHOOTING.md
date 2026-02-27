# 🆘 SOLUCIÓN DE PROBLEMAS

## "npm start" falla

### Error: Cannot find module 'helmet'

```bash
# Solución:
npm install

# O reinstalar todo:
rm -r node_modules
npm install
```

### Error: Port 3000 already in use

```bash
# Cambiar puerto en .env:
PORT=3001
# O:
PORT=3002

# Luego:
npm start

# O matar proceso en puerto 3000:
Get-Process | where {$_.ProcessName -eq "node"} | Stop-Process
```

### Error: Cannot connect to database

```bash
# Verificar credenciales en .env:
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=...
DB_NAME=innar_clinica

# Verificar que MySQL está corriendo:
# En XAMPP: Start → Apache, MySQL

# Probar conexión manual:
mysql -u root -p -h localhost
```

---

## Transacciones no funcionan

### "SELECT FOR UPDATE not supported"

```bash
# Verificar que se usan InnoDB (no MyISAM):
mysql -u root -p innar_clinica

mysql> SHOW ENGINE INNODB STATUS;
# Debería mostrar: INNODB ENGINE

# Si no:
mysql> ALTER TABLE citas_electro ENGINE=InnoDB;
```

### Transacción lenta

```bash
# Verificar índices:
mysql -u root -p innar_clinica
mysql> SHOW INDEX FROM citas_electro;

# Agregar índices si faltan:
mysql> CREATE INDEX idx_electro_fecha_hora ON citas_electro(fecha, hora_agendamiento);
mysql> CREATE INDEX idx_electro_estado ON citas_electro(estado);
```

---

## Backups no se crean

### "mysqldump: not found"

```bash
# Verificar ubicación:
Get-Command mysqldump

# Si no está:
# Opción 1: Agregar XAMPP MySQL a PATH
# Opción 2: Usar ruta completa en utils/backup.js

# Para XAMPP:
$env:PATH += ";C:\xampp\mysql\bin"
node utils/backup.js
```

### "Backup error - cannot access backups folder"

```bash
# Crear carpeta manualmente:
mkdir backups

# O cambiar en .env:
BACKUP_DIR=C:\temp\backups  # Otra ruta con permisos
```

### Logs no muestran backups

```bash
# Verificar que logs/ existe:
# Si no:
mkdir logs

# Ver logs:
Get-Content logs/app.log | Select-String "backup" -i

# Si está vacío:
# - Backups automáticos aún no se han ejecutado
# - Son a las 2 AM y cada 6 horas
# - Hacer backup manual: node utils/backup.js
```

---

## HTTPS no funciona

### "HTTPS not starting"

```bash
# Verificar .env:
# USE_HTTPS=true

# Verificar certificados:
ls server.crt server.key
# Si faltan:
node utils/generate-cert.js

# Ver error en logs:
Get-Content logs/app.log | tail -20
```

### "Browser shows security warning and won't connect"

**Normal para certificados autofirmados:**
- Chrome: Click "Advanced" → "Proceed to localhost"
- Firefox: "Accept the Risk" → "Confirm Security Exception"

```bash
# Verificar que realmente HTTPS está activo:
curl -v https://localhost:3000 2>&1 | Select-String "SSL\|certificate"
```

### "Generate-cert.js falla"

```bash
# Opción 1: OpenSSL en XAMPP
C:\xampp\apache\bin\openssl.exe req -x509 -newkey rsa:2048 -keyout server.key -out server.crt -days 365 -nodes -subj "/CN=localhost"

# Opción 2: Instalar OpenSSL global
choco install openssl

# Opción 3: Usar certificado de proyecto anterior
# Copiar: server.crt + server.key desde otro proyecto
```

---

## Helmet.js bloquea recursos

### "Content-Security-Policy error"

```bash
# Error en DevTools:
# Refused to load the script from 'https://...' 
# because it violates the following Content Security Policy directive

# Solución en server.js (línea ~65):
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.ejemplo.com"],
      // Agregar más dominios aquí
    }
  }
}));
```

---

## Socket.io no funciona

### "Socket.io connect failed"

```bash
# Verificar en browser DevTools:
# Console tab → Buscar errores de socket

# En server.js:
# Socket.io debe estar configurado (está por defecto)

# Reiniciar servidor:
# npm start
```

---

## Base de datos corrupta

### "MySQL error: Table 'citas_electro' is marked as crashed"

```bash
# Reparar tabla:
mysql -u root -p innar_clinica
mysql> REPAIR TABLE citas_electro;

# O restaurar desde backup:
mysql -u root -p innar_clinica < backups/backup-innar_clinica-2024-01-15-14-30-45.sql
```

---

## Logs llenos

### "logs/ carpeta muy grande"

```bash
# Ver tamaño:
(Get-Item logs -Recurse | Measure-Object -Sum Length).Sum

# Limpiar logs antiguo:
rm logs/app.log

# Logs se regenerarán automáticamente
```

---

## Performance lento

### "Servidor responde lento"

```bash
# Revisar CPU:
Get-Process node | Select-Object ProcessName, CPU, MemoryMB

# Si CPU > 80% durante backups: normal
# Si CPU > 80% siempre: revisar queries lentas

# Ver queries en MySQL:
mysql> SHOW PROCESSLIST;
```

### "Citas toman mucho para creer"

```bash
# Podría ser transacciones tardías
# Ver logs:
Get-Content logs/app.log | Select-String "transaction\|INSERT"

# Soluciones:
# 1. Agregar índices (ver "Transacción lenta" arriba)
# 2. Aumentar MySQL max_connections
# 3. Revisar si BD está llena
```

---

## Archivo .ini o de config corrupto

### ".env corrupto"

```bash
# Restaurar desde backup:
# 1. Git restore .env (si estás usando git)
# 2. O editar manualmente .env

# Verificar que tiene:
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=...
DB_NAME=innar_clinica
USE_HTTPS=false
PORT=3000
```

---

## Aún no funciona?

### Obtener más información

```bash
# Version de Node
node --version

# Version de npm
npm --version

# Ver todas las dependencias
npm ls

# Ver estructura de proyecto
tree /A /F innar-app

# Ver procesos de Node
Get-Process | where {$_.ProcessName -eq "node"} | Format-List
```

### Reinicio completo

```bash
# Detener servidor
# Ctrl + C en terminal

# Limpiar
rm -r node_modules
rm package-lock.json

# Reinstalar
npm install

# Reiniciar
npm start
```

---

## Es un bug del código?

Si creem que encontraste un bug:

1. **Reproducir el error:**
   - ¿Qué vendiste hacer?
   - ¿Qué pasó?
   - ¿Qué debería pasar?

2. **Ver logs:**
   ```bash
   Get-Content logs/app.log -Tail 100
   Get-Content logs/errors.log
   ```

3. **Stack trace:**
   - Copiar error completo
   - Incluir línea de código problemática

4. **Contexto:**
   - ¿Cuándo empezó?
   - ¿Algo cambió?
   - ¿Qué comando ejecutaste?

---

Ver [INICIO.md](./INICIO.md) para comandos rápidos.

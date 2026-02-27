# 🔐 HTTPS Y CERTIFICADOS

## Estado actual

- `USE_HTTPS=false` (HTTP simple) ✅ **RECOMENDADO PARA DESARROLLO**
- Sin necesidad de certificados

---

## ✅ Opción 1: HTTP (ACTUALMENTE EN USO)

**Lo más simple, lo que ya estás usando:**

```bash
npm start
# http://localhost:3000
```

**Ventajas:**
- ✅ Arranca inmediatamente
- ✅ Sin complicaciones
- ✅ Perfecto para desarrollo
- ✅ Helmet.js aún protege con headers
- ✅ Socket.io funciona

**Desventajas:**
- ❌ Sin encriptación (OK para localhost)

---

## ⚠️ Opción 2: HTTPS (Solo si lo necesitas)

**Si necesitas HTTPS en desarrollo**, estas son las opciones:

### 2A: Usar Git Bash (más simple)

Si tienes Git instalado:

```bash
# 1. Abrir Git Bash
# 2. Navegar: cd c:\xampp\htdocs\innar-app\innar-app
# 3. Ejecutar:
openssl req -x509 -newkey rsa:2048 \
  -keyout server.key -out server.crt \
  -days 365 -nodes -subj "/CN=localhost"

# 4. Cambiar en .env: USE_HTTPS=true
# 5. npm start
```

### 2B: Instalar OpenSSL global

```bash
# Descargar e instalar:
# https://slproweb.com/products/Win32OpenSSL.html
# (Seleccionar "Add OpenSSL to PATH")

# Luego:
node utils/generate-cert.js
```

### 2C: Usar WSL2

```bash
wsl openssl req -x509 -newkey rsa:2048 \
  -keyout server.key -out server.crt \
  -days 365 -nodes -subj "/CN=localhost"
```

---

## 🎯 **RECOMENDACIÓN FINAL**

Para desarrollo: **mantén HTTP (`USE_HTTPS=false`)**

Es más rápido, no requiere dependencias, y es lo que 99% de desarrolladores usan.

---

Ver [INICIO.md](./INICIO.md) para volver a lo básico.


**Más simple, perfecto para desarrollo:**
```bash
npm start
# http://localhost:3000
```

**Beneficio:** Sin configuración adicional  
**Drawback:** Sin encriptación (OK para localhost)

---

## Opción 2: HTTPS con certificado autofirmado

**Recomendado** para desarrollo completo:

### Paso 1: Generar certificado

```bash
node utils/generate-cert.js
```

**Output esperado:**
```
🔐 GENERADOR DE CERTIFICADO AUTOFIRMADO
Parámetros:
  - Algoritmo: RSA 2048-bit
  - Validez: 365 días
  - CN: localhost

✅ Certificado autofirmado generado exitosamente!

Archivos creados:
   - Clave privada: C:\...\server.key
   - Certificado: C:\...\server.crt
```

**Se crean 2 archivos:**
- `server.key` - Clave privada (mantener segura)
- `server.crt` - Certificado público

### Paso 2: Activar HTTPS

Cambiar en `.env`:
```bash
USE_HTTPS=false    # ← Cambiar esto
# A:
USE_HTTPS=true
```

### Paso 3: Iniciar servidor

```bash
npm start
```

**Output esperado:**
```
🔐 Iniciando servidor con HTTPS...
✅ HTTPS activado con certificado autofirmado
OK
```

### Paso 4: Acceder en navegador

```
https://localhost:3000
```

⚠️ **El navegador mostrará advertencia - ES NORMAL:**

```
Advertencia: tu conexión no es privada
⚠️ Antes de continuar
ERR_CERT_AUTHORITY_INVALID
```

**Solución:**
- **Chrome:** Click "Continuar de todas formas" o "Advanced" → "Proceed to localhost"
- **Firefox:** Click en "Aceptar riesgo" → "Confirmar excepción"
- **Edge:** Similar a Chrome

---

## Verificar que HTTPS funciona

### En navegador (Chrome DevTools)

1. **Abrir DevTools:** F12 o Ctrl+Shift+I
2. **Ir a Network**
3. **Recargar la página** (F5)
4. **Buscar la primera solicitud**
5. **Mirar la columna "Protocol"** - Debe mostrar: **h2** (HTTP/2)

Si ves `h2` o `http/1.1` → HTTPS funciona ✅

### Desde terminal

```bash
# Ver que HTTPS responde
curl -v https://localhost:3000 2>&1 | Select-String "SSL\|certificate\|HTTP"

# Output esperado:
# * SSL connection using TLSv1.3
# * Server certificate: CN = localhost
# < HTTP/2 200
```

---

## Headers de seguridad (solo con HTTPS)

Verificar que Helmet.js está activo:

1. **DevTools → Network**
2. **Click en cualquier solicitud**
3. **Ir a Response Headers**
4. **Buscar:**
   - `X-Frame-Options: DENY` ✅
   - `X-Content-Type-Options: nosniff` ✅
   - `Strict-Transport-Security: max-age=...` ✅

Si ves estos headers → Helmet.js funciona ✅

---

## Producción: Let's Encrypt (no autofirmado)

Para producción con dominio real:

```bash
# Instalar certbot
choco install certbot  # Si tienes Chocolatey

# O descargar desde:
# https://certbot.eff.org/

# Generar certificado (requiere que el dominio apunte a tu servidor):
certbot certonly --standalone -d tudominio.com

# Certbot genera:
# - /etc/letsencrypt/live/tudominio.com/fullchain.pem
# - /etc/letsencrypt/live/tudominio.com/privkey.pem

# Auto-renovación cada 90 días
```

---

## Certificado expirado?

```bash
# Ver fecha de vencimiento
openssl x509 -in server.crt -noout -dates

# Output:
# notBefore=Jan 15 10:30:00 2024 GMT
# notAfter=Jan 15 10:30:00 2025 GMT
```

Si está expirado:
```bash
# Regenerar
rm server.crt server.key
node utils/generate-cert.js
```

---

## Troubleshooting HTTPS

### "Certificate not found"
```bash
# Verificar que existen:
ls -la server.crt server.key

# Si no existen:
node utils/generate-cert.js
```

### "Generation failed - OpenSSL not found"
```bash
# Opción 1: Instalar OpenSSL
choco install openssl

# Opción 2: Usar XAMPP OpenSSL
# C:\xampp\apache\bin\openssl.exe está disponible

# Opción 3: Usar PowerShell (Windows 10+)
# Ver https://docs.microsoft.com/en-us/powershell/module/pki/
```

### "Browser rejects certificate"
Es normal para certificados autofirmados. Ignorar la advertencia.

### "Redirige a HTTP en lugar de HTTPS"
```bash
# Verificar .env:
USE_HTTPS=true

# Verificar archivos existen:
ls server.crt server.key

# Reiniciar servidor
```

---

## Resumen

| Ambiente | Recomendación | Comando |
|----------|--------------|---------|
| Desarrollo simple | HTTP | `npm start` |
| Desarrollo completo | HTTPS autofirmado | `npm start` (con `USE_HTTPS=true`) |
| Pruebas de seguridad | HTTPS autofirmado | Same |
| Producción | Let's Encrypt | Setup adicional |

---

Ver [INICIO.md](./INICIO.md) para comandos rápidos.

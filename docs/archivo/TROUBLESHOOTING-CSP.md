# 🚨 Troubleshooting CSP & CDN Errors

## 🎯 Problema Actual Resuelto

**Error que viste en browser console:**
```
Uncaught Error: Loading the script 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' 
violates the following Content Security Policy directive: "script-src 'self' 'unsafe-inline'". 
Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. 
The action has been blocked.
```

**Estado:** ✅ RESUELTO en `server.js` línea 30-57

---

## 🔍 Cómo Verificar que Está Arreglado

### Paso 1: Limpiar Cache del Navegador
```
Chrome:    Ctrl + Shift + Delete → Cookies y datos en caché → Limpiar
Firefox:   Ctrl + Shift + Delete → Cookies y almacenamiento en caché → Limpiar
Edge:      Ctrl + Shift + Delete → Datos a eliminar → Caché → Limpiar
```

### Paso 2: Hard Refresh
```
Chrome/Firefox/Edge:  Ctrl + Shift + R  (Hard refresh)
O:                    Ctrl + F5
O:                    En DevTools → Botón refresh derecha + mantener
```

### Paso 3: Verificar en DevTools
```
1. Abre DevTools (F12)
2. Vé a la pestaña "Console"
3. Busca errores que digan "violates...CSP"
4. ✅ NO debe haber ninguno
```

### Paso 4: Verificar que Recursos Cargan
```
1. En DevTools, vé a pestaña "Network"
2. Busca estas peticiones:
   - xlsx.full.min.js (cdnjs) → Status 200 ✅
   - crypto-js.min.js (cdnjs) → Status 200 ✅
   - css?family=Bodoni (fonts.googleapis) → Status 200 ✅
3. Si ves Status 304 también está bien (cached)
```

---

## 🐛 Si Todavía Ves Errores CSP

### Problema: Aún recibiendo CSP errors en console

**Solución 1: Verificar que el archivo se guardó correctamente**
```powershell
# Buscar en server.js la configuración de Helmet
findstr /N "contentSecurityPolicy" server.js
```

**Esperado:**
```
Línea 30: contentSecurityPolicy: {
...
Línea 37: "https://cdnjs.cloudflare.com"
Línea 42: "https://fonts.googleapis.com"
```

**Solución 2: Restart del servidor**
```powershell
# Detener servidor (si está ejecutándose)
Taskkill /IM node.exe /F

# Reiniciar
npm start
# O
node server.js
```

**Solución 3: Verificar la línea exacta en server.js**
```powershell
Get-Content server.js | Select-Object -Index 30-60
```

---

## 📋 Referencia Rápida CSP

### Líneas modificadas en `server.js`

**Línea ~30-57 (Helmet configuration):**
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com"  // ← XLSX, CryptoJS
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"   // ← Google Fonts CSS
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"      // ← Google Fonts woff2
      ],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    }
  }
}));
```

---

## 🆘 Errores Comunes & Soluciones

### Error 1: "Loading the script violates CSP directive"

**Síntomas:**
- Script no carga desde CDN
- Error en console menciona CDN
- Ejemplo: `https://cdnjs.cloudflare.com/...`

**Causa:**
- CDN NO está en la whitelist de `scriptSrc`

**Solución:**
```javascript
// Agregar el CDN a scriptSrc
scriptSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://cdnjs.cloudflare.com",    // ← Agregar CDN aquí
  "https://cdn.jsdelivr.net"         // ← O aquí
]
```

### Error 2: "Loading the stylesheet violates CSP directive"

**Síntomas:**
- Google Fonts CSS no carga
- Página se ve sin estilos personalizados
- Error menciona `fonts.googleapis.com`

**Causa:**
- `fonts.googleapis.com` NO está en `styleSrc`

**Solución:**
```javascript
styleSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://fonts.googleapis.com"     // ← Agregar aquí
]
```

### Error 3: "Loading the font violates CSP directive"

**Síntomas:**
- Fuentes personalizadas no cargan
- Solo se ve Times New Roman o sans-serif default
- Error menciona `fonts.gstatic.com` o similar

**Causa:**
- `fonts.gstatic.com` NO está en `fontSrc`

**Solución:**
```javascript
fontSrc: [
  "'self'",
  "https://fonts.gstatic.com",       // ← Agregar aquí
  "https://fonts.staticont.com"      // ← O similar
]
```

### Error 4: XMLHttpRequest Cross-Origin

**Síntomas:**
- AJAX/Fetch calls al servidor fallan
- Error: "violates CSP directive: connect-src"
- Console: "blocked:other"

**Causa:**
- HTTPS pero `connectSrc` es muy restrictivo

**Solución:**
```javascript
connectSrc: [
  "'self'",
  "https:",    // ← Permite cualquier HTTPS
  "ws://",     // ← Si usas WebSocket
  "wss://"     // ← WebSocket seguro
]
```

---

## 🧪 Verificar Configuración Actual

### Script para verificar CSP en server.js

```powershell
# Buscar toda la configuración de Helmet
$content = Get-Content -Path "server.js" -Raw
$cspStart = $content.IndexOf("contentSecurityPolicy")
$subContent = $content.Substring($cspStart, 2000)
Write-Host $subContent
```

### Verificar específicamente CDNs permitidos
```powershell
findstr "cdnjs\|googleapis\|gstatic\|jsdelivr" server.js
```

---

## 🔧 Agregar Nuevos CDNs (Si necesitas)

### Paso 1: Identificar qué CDN necesitas
```
Ejemplo: Quieres agregar Bootstrap CDN
URL: https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css
CDN base: https://cdn.jsdelivr.net
Tipo: CSS (va en styleSrc)
```

### Paso 2: Editar server.js
```javascript
styleSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://fonts.googleapis.com",
  "https://cdn.jsdelivr.net"         // ← AGREGAR AQUÍ
]
```

### Paso 3: Guardar y reiniciar
```powershell
# Reiniciar servidor
Taskkill /IM node.exe /F
npm start
```

### Paso 4: Verificar en console
```
F12 → Console → Debe estar limpia
```

---

## 📊 Directivas Usadas en Tu App

| Directiva | Valor | Archivo |
|-----------|-------|--------|
| `scriptSrc` | 'self', 'unsafe-inline', cdnjs.cloudflare.com | server.js L35 |
| `styleSrc` | 'self', 'unsafe-inline', fonts.googleapis.com | server.js L41 |
| `fontSrc` | 'self', fonts.gstatic.com | server.js L46 |
| `connectSrc` | 'self', https: | server.js L51 |

---

## ⚠️ Notas de Seguridad

### `'unsafe-inline'` 
- ✅ Necesario AHORA para funcionamiento
- ⚠️ Considera remover en producción
- 🔐 Aumenta riesgo XSS pero es controlable

### Si quieres remover `'unsafe-inline'`
```
Necesitarías:
1. Mover todos los <script inline> a archivos .js
2. Mover todos los <style inline> a archivos .css  
3. Usar Nonce o Hash para scripts críticos
4. Implementar en app.js y style.css
```

---

## 🎯 Checklists

### ✅ Después de la corrección CSP

- [ ] Clear cache del navegador (Ctrl+Shift+Delete)
- [ ] Hard refresh (Ctrl+Shift+R)
- [ ] Abrir DevTools (F12)
- [ ] Revisar Console → Sin errores CSP
- [ ] Revisar Network → XLSX, CryptoJS, Fonts = 200/304
- [ ] Verificar que Google Fonts aplica (texto diferente)
- [ ] Verificar que XLSX funciona (import file)
- [ ] Verificar que CryptoJS funciona (login)

### 🚀 Si todo funciona
```
✅ XLSX importa archivos correctamente
✅ Google Fonts muestra estilos personalizados
✅ CryptoJS encripta datos en cliente
✅ No hay errores en console
✅ Aplicación lista para uso
```

### ❌ Si aún hay problemas
```
1. Verifica que server.js se guardó (grep_search)
2. Reinicia el servidor (Taskkill + npm start)
3. Limpia cache del navegador
4. Revisa líneas 30-57 de server.js
5. Compara con la guía CSP-SEGURIDAD.md
```

---

## 📞 Comandos Útiles

### Ver logs en tiempo real
```powershell
Get-Content logs\app.log -Wait
```

### Buscar errores CSP en logs
```powershell
Select-String "CSP|helmet" logs\app.log
```

### Reiniciar todo
```powershell
# Matar node
Taskkill /IM node.exe /F

# Esperar 2 segundos
Start-Sleep -Seconds 2

# Reiniciar
npm start
```

### Verificar puerto 3000
```powershell
netstat -ano | findstr :3000
```

---

## 🔐 Seguridad en Producción

Cuando vayas a producción, considera:

```javascript
// PRODUCCIÓN - Versión más segura
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        // REMOVER: 'unsafe-inline',  
        "https://cdnjs.cloudflare.com"
      ],
      styleSrc: [
        "'self'",
        // REMOVER: 'unsafe-inline',
        "https://fonts.googleapis.com"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https:"],
      connectSrc: ["'self'", "https:"],
      // Agregar esto para reportes
      reportUri: "/csp-violation-report"
    }
  }
}));

// Endpoint para recibir reportes
app.post('/csp-violation-report', (req, res) => {
  logger.warn('CSP Violation:', req.body);
  res.status(204).send();
});
```

---

**Estado:** ✅ CSP ARREGLADO  
**Próximo paso:** Verificar en navegador (hard refresh)  
**Contacto:** Revisa docs/CSP-SEGURIDAD.md para más detalles

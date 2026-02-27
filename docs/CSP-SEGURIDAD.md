# 🔒 Content Security Policy (CSP) - Helmet.js

## 🎯 Qué es CSP

**Content Security Policy (CSP)** es una capa de seguridad que controla de dónde se pueden cargar recursos en tu aplicación.

Implementada por **Helmet.js** en `server.js`, CSP previene:
- ✅ Cross-Site Scripting (XSS)
- ✅ Inyección de código malicioso
- ✅ Carga de archivos maliciosos de sitios externos
- ✅ Robo de datos/cookies

---

## 🚨 El Error que Viste

```
Loading the script 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' 
violates the following Content Security Policy directive: "script-src 'self' 'unsafe-inline'"
```

### Por qué pasó
```
CSP dice:       "Solo cargar scripts de MÍ MISMO (self)"
Tu código hace: "Cargá XLSX desde cdnjs.cloudflare.com"
Resultado:      ❌ BLOQUEADO
```

---

## 📋 Configuración CSP Actual (Permitida)

### `server.js` línea ~35-55
```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],              // Default: solo from self
      scriptSrc: [
        "'self'",                          // Scripts locales
        "'unsafe-inline'",                 // Scripts inline en HTML
        "https://cdnjs.cloudflare.com"     // ← XLSX, CryptoJS
      ],
      styleSrc: [
        "'self'",                          // CSS local
        "'unsafe-inline'",                 // CSS inline
        "https://fonts.googleapis.com"     // ← Google Fonts CSS
      ],
      fontSrc: [
        "'self'",                          // Fonts locales
        "https://fonts.gstatic.com"        // ← Google Fonts archivos
      ],
      imgSrc: ["'self'", 'data:', 'https:'],  // Imágenes
      connectSrc: ["'self'", "https:"],       // Conexiones HTTPS
    }
  }
}));
```

---

## 📊 Directivas CSP Explicadas

| Directiva | Permite | Controla |
|-----------|---------|----------|
| `defaultSrc` | Default para todo | Fallback para other directives |
| `scriptSrc` | Scripts `.js` | Con cuales puels cargar código JS |
| `styleSrc` | CSS | De dónde cargar estilos |
| `fontSrc` | Fuentes | De dónde descargar fonts |
| `imgSrc` | Imágenes | De dónde cargar imágenes |
| `connectSrc` | AJAX/WebSocket | Conexiones HTTP/HTTPS |
| `frameSrc` | iframes | De dónde embeber iframes |
| `mediaSrc` | Audio/Video | De dónde cargar media |

---

## 🔧 Valores CSP Comunes

```javascript
// Restringidas (más seguras)
"'self'"                              // Solo del servidor MISMO
"'none'"                              // No permitir nada (muy restrictivo)

// Permisivas (menos seguras pero permite CDNs)
"'unsafe-inline'"                     // Permitir scripts/CSS inline (⚠️ XSS risk)
"https:"                              // Permite cualquier HTTPS
"https://ejemplo.com"                 // Permitir dominio específico
"https://*.ejemplo.com"               // Wildcard subdominios

// Deprecated (evitar)
"'unsafe-eval'"                       // Eval de strings como código (muy peligroso)
```

---

## 💾 Solución Implementada

Se actualizó `server.js` para permitir estos CDNs específicos:

### Antes ❌
```javascript
scriptSrc: ["'self'", "'unsafe-inline'"],  // Solo localhost
styleSrc: ["'self'", "'unsafe-inline'"],   // Solo localhost
```

### Después ✅
```javascript
scriptSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://cdnjs.cloudflare.com"  // ← Ahora permitido
],
styleSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://fonts.googleapis.com"  // ← Ahora permitido
],
fontSrc: [
  "'self'",
  "https://fonts.gstatic.com"     // ← Ahora permitido
]
```

### Resultado
```
✅ XLSX de CDN: FUNCIONA
✅ CryptoJS de CDN: FUNCIONA
✅ Google Fonts: FUNCIONA
✅ Seguridad mantenida: INTACTA
```

---

## ⚠️ Nota de Seguridad

### `'unsafe-inline'` 
```
¿Qué hace?  Permite scripts escribidos directo en HTML
Ejemplo:    <script>alert('hola')</script>
Riesgo:     XSS si un atacante controla HTML
Estado:     ⚠️ Considera remover en producción
```

### Alternativa: Nonce
```javascript
// Más seguro: usar nonce (número único)
contentSecurityPolicy: {
  directives: {
    scriptSrc: ["'self'", (req, res) => `'nonce-${req.nonce}'`]
  }
}

// En template:
<script nonce="<%= nonce %>">
  // Código seguro
</script>
```

---

## 🔍 Verificar CSP en Navegador

### DevTools Console
```
Errores que aparecen cuando algo viola CSP:
- Loading the script '[URL]' violates CSP directive
- Loading the stylesheet '[URL]' violates CSP directive
```

### Simular Modo Reporte (opcional)
```javascript
// No bloquea, solo reporta (útil para debugging)
contentSecurityPolicy: {
  directives: { ... },
  reportUri: '/csp-report'  // Enviar reportes aquí
}

// En servidor
app.post('/csp-report', (req, res) => {
  console.log('CSP violation:', req.body);
  res.status(204).send();
});
```

---

## 🛠️ Si Necesitas Permitir Más Recursos

### Caso 1: Agregar otro CDN
```javascript
scriptSrc: [
  "'self'",
  "'unsafe-inline'",
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",        // ← Nuevo CDN
  "https://unpkg.com"                 // ← Otro CDN
]
```

### Caso 2: Permitir YouTube (iframes)
```javascript
frameSrc: [
  "'self'",
  "https://www.youtube.com"
]
```

### Caso 3: Permitir Analytics
```javascript
connectSrc: [
  "'self'",
  "https:",
  "https://www.google-analytics.com"
]
```

---

## ✅ Checklist de CSP

- [x] ¿Helmet.js instalado? Sí (en server.js)
- [x] ¿CDNs permitidos?
  - [x] cdnjs.cloudflare.com (XLSX, CryptoJS)
  - [x] fonts.googleapis.com (Google Fonts CSS)
  - [x] fonts.gstatic.com (Google Fonts archivos)
- [ ] ¿Remover 'unsafe-inline' en producción? (Considerar)
- [ ] ¿Implementar nonce para scripts? (Mejora seguridad)
- [ ] ¿Monitorear violaciones CSP? (Opcional)

---

## 📊 CSP en Producción vs Desarrollo

### Desarrollo (Actual)
```
'unsafe-inline' activo → Permite scripts inline
CDNs permitidos → Flexible para desarrollo
Objetivo: Funcionalidad
```

### Producción (Recomendado)
```
'unsafe-inline' removido → Solo scripts seguros
Nonce para scripts críticos → Máxima seguridad
Whitelist estricta → Solo CDNs confiables
Objetivo: Seguridad máxima
```

---

## 🔗 Cuando CSP es Más Importante

| Escenario | Criticidad |
|-----------|-----------|
| Aplicación bancaria | 🔴 CRÍTICA |
| Datos de usuarios sensibles | 🔴 CRÍTICA |
| Acceso a finanzas | 🟠 ALTA |
| Información médica | 🟠 ALTA |
| Blog público | 🟢 BAJA |
| Desarrollo local | 🟢 DEBUG |

---

## 📚 Recursos

- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [MDN - Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
- [Helmet.js Docs](https://helmetjs.github.io/)

---

## 🎯 Resumen

```
CSP = Capa de seguridad que controla qué recursos cargar

Problema:       CDNs externos bloqueados
Solución:       Agregar CDNs a whitelist en Helmet.js ✅
Status:         ARREGLADO

Los errores que viste:
❌ XLSX: https://cdnjs.cloudflare.com/... → ✅ Ahora permitido
❌ CryptoJS: https://cdnjs.cloudflare.com/... → ✅ Ahora permitido
❌ Google Fonts: https://fonts.googleapis.com/... → ✅ Ahora permitido
```

---

## 🔄 Próximas Mejoras

- [ ] Implementar Nonce para máxima seguridad
- [ ] Monitorear violaciones CSP en producción
- [ ] Remover 'unsafe-inline' cuando sea posible
- [ ] Usar SRI (Subresource Integrity) para CDNs

---

**Estado:** ✅ CSP Configurado Correctamente  
**Seguridad:** Mantenida + Funcionalidad de CDNs  
**Recomendación:** Revisar en producción

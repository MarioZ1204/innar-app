# 🚀 Verificar Socket.IO en Navegador

## ✅ Método 1: Network Tab (1 minuto)

1. Abri: `http://localhost:3000`
2. Presiona: `F12` (DevTools)
3. Vé a: Pestaña `Network`
4. Busca: `socket.io`
5. Debería ver:
   - URL: `socket.io/?EIO=4&transport=polling` (o websocket)
   - Status: `200` o `101` (WebSocket upgrade)
   - Tipo: `xhr`

Si ves esto ✅ → Socket.IO funciona

---

## ✅ Método 2: Console Tab (30 segundos)

1. `F12` (DevTools)
2. Pestaña: `Console`
3. Ejecuta:
```javascript
typeof io === 'undefined' ? '❌ Socket.IO no cargó' : '✅ Socket.IO listo'
```

4. También ejecuta:
```javascript
// Ver si hay instancia de socket
io() 
// Debería retornar algo como: Socket(...)
```

Si funciona ✅ → Socket.IO disponible

---

## 🧪 Método 3: Testar Evento WebSocket

1. Console:
```javascript
const socket = io();

socket.on('connect', () => {
  console.log('✅ Conectado a Socket.IO');
  console.log('Socket ID:', socket.id);
});

socket.on('disconnect', () => {
  console.log('❌ Desconectado de Socket.IO');
});

socket.on('error', (error) => {
  console.error('❌ Error Socket.IO:', error);
});
```

Debería ver: `✅ Conectado a Socket.IO` + id

---

## 🔔 Método 4: Testar Emit

1. Console:
```javascript
const socket = io();

socket.on('stats:actualizar', (data) => {
  console.log('✅ Recibido evento stats:actualizar', data);
});

// Emitir evento
socket.emit('stats:solicitar');
```

Debería recibir `stats:actualizar` en respuesta

---

## ✅ Checklist Rápido

| Paso | Resultado | Status |
|------|-----------|--------|
| socket.io en Network | Status 200/101 | ✅ |
| `io` en console | Retorna Socket() | ✅ |
| `connect` event | Se ejecuta | ✅ |
| Socket ID | Tiene ID único | ✅ |
| Emitir evento | Recibe respuesta | ✅ |

---

## ❌ Si No Funciona

### Problema 1: socket.io no aparece en Network
**Solución:**
```
1. Ctrl+Shift+R (hard refresh)
2. Ctrl+Shift+Delete (clear cache)
3. Refrescar de nuevo
```

### Problema 2: Status no es 200/101
**Solución:**
```
1. Verificar que servidor está en :3000
   netstat -ano | findstr :3000
2. Si no está, reiniciar:
   npm start
3. Si está, revisar logs:
   Get-Content logs/app.log -Wait
```

### Problema 3: `io` retorna undefined
**Solución:**
```javascript
// Verificar que socket.io cliente se cargó
// En Network, buscar: "/socket.io/socket.io.js"
// Si no está, revisar public/app.js:
// Debería haber: <script src="/socket.io/socket.io.js"></script>
```

### Problema 4: Error en console
**Solución:**
```
1. Ver error exacto en console (F12)
2. Revisar logs del servidor:
   Get-Content logs/app.log -Wait
3. Posible CORS issue - revisar server.js L3288+
```

---

## 📋 Resumen

| Escenario | Verificar |
|-----------|-----------|
| ¿Socket.IO carga? | Network tab: socket.io status 200/101 |
| ¿Socket está listo? | Console: `io()` retorna Socket |
| ¿Se conecta? | Console: `socket.on('connect')` se ejecuta |
| ¿Comunica bidireccional? | Emitir y recibir eventos |

---

**Estado:** 🟢 Socket.IO OPERATIVO  
**Próximo:** Ver que los eventos de WebSocket funcionen en tiempo real

¿Qué ves en console cuando ejecutas `io()`?

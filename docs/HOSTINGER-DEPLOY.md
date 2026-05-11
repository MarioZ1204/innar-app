# Despliegue en Hostinger (Git -> Node.js App)

Esta guia deja la app estable en Hostinger usando despliegue desde Git.

## 1) Preparar repositorio antes de subir

Ejecuta en local:

```bash
npm install
npm run deploy:check
```

Si falla `deploy:check`, no subas cambios hasta corregirlos.

## 2) Configurar Node.js App en hPanel

En Hostinger > `Advanced` > `Node.js`:

- `Node.js version`: 18+ (ideal 20 LTS)
- `Application root`: carpeta donde Hostinger clona tu repo
- `Application URL`: `innarapp.neurocienciasnarino.com`
- `Application startup file`: `server.js`

Importante: el dominio debe apuntar a la Node.js App, no a un sitio estatico de `public_html`.

## 3) Variables de entorno en Hostinger

Configura en el panel de Node.js (o archivo `.env` en servidor):

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `SESSION_SECRET`
- `NODE_ENV=production`
- `FRONTEND_URL=https://innarapp.neurocienciasnarino.com`
- `PORT` (si Hostinger lo requiere; normalmente lo inyecta)
- `SOCKET_IO_PATH=/api/socket.io` (recomendado si `/socket.io` devuelve 404 por Apache/proxy — ver punto 5)

Usa `.env.hostinger.example` como plantilla. Nunca subas secretos reales.

## 4) Flujo recomendado de despliegue

1. Haz commit y push en Git.
2. En Hostinger, sincroniza/actualiza el repo.
3. Ejecuta `npm install` en el servidor (si no se ejecuta automatico).
4. Reinicia la Node.js App desde hPanel.
5. Verifica:
   - `https://innarapp.neurocienciasnarino.com/api/health`
   - `https://innarapp.neurocienciasnarino.com/api/version`
   - `https://innarapp.neurocienciasnarino.com/`

## 5) Socket.IO (404 en `/socket.io/` pero la app carga)

- Lo ideal es que **el dominio apunte sólo** a la **Node.js App** (véase punto 2). Así todo el tráfico llega al proceso Node y Socket.IO monta bien en `/socket.io/`.
- Si el frontal es **Apache** con proxy y sólo rutas **`/api/*`** llegan a Node con fiabilidad, define en `.env`:
  - `SOCKET_IO_PATH=/api/socket.io`
  (ya está incluido en `.env.hostinger.example`.) Reinicia la app Node.

## 6) Diagnostico rapido 403/503

### Si ves 403 en `/`

- El dominio no esta pasando por Node.js App.
- O el servidor web esta sirviendo una carpeta sin `index` y con `Options -Indexes`.
- Revisa que `Application URL` este enlazada correctamente en Node.js App.

### Si ves 503

- La app no arranco o se cayo.
- Revisa logs de Node.js App en Hostinger.
- Verifica que no falten variables requeridas (`DB_*`, `SESSION_SECRET`).

## 7) Checklist final

- [ ] `npm run deploy:check` pasa en local
- [ ] `server.js` es el startup file
- [ ] Variables de entorno completas en Hostinger
- [ ] App reiniciada despues de pull/install
- [ ] `/api/health` responde `ok: true`
- [ ] No hay secretos reales versionados en Git

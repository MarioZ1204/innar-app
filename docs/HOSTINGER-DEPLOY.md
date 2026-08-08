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
- `SOPORTES_NIT_OBLIGADO` — NIT del prestador, solo dígitos (ej. `901164565`), para nombres de archivos en armado de soportes
- Socket.IO queda montado en la ruta estándar **`/socket.io/`**. El proxy debe reenviar esa ruta al proceso Node (ver punto 5).

Usa `.env.hostinger.example` como plantilla. Nunca subas secretos reales.

## 4) Archivos PDF de Soportes (no perderlos al desplegar)

Los PDF de **Reportes PDX** y **Armado** se guardan en disco, **no en MySQL**. La base de datos solo guarda la ruta (`ruta_relativa`).

Si los archivos viven dentro de la carpeta del repositorio (`public/uploads/`), cada **git pull**, **redeploy** o carpeta de release nueva deja los registros en BD pero el mensaje **«Archivo no en disco»** aparece porque el PDF ya no está.

**Solución (recomendada):**

1. Cree una carpeta persistente **fuera** del clone de Git, por ejemplo:
   `private_uploads` al mismo nivel que el proyecto o en el home del hosting.
2. En variables de entorno de Node.js defina:
   `UPLOADS_DIR=/ruta/absoluta/private_uploads`
3. Reinicie la app.
4. **Una sola vez**, si había PDF en `public/uploads/soportes`, cópielos a:
   `$UPLOADS_DIR/soportes/` (manteniendo `pdx/`, `armado/`, etc.).

Compruebe con `/api/health/deep` (usuario autenticado): el bloque `uploadsDir` debe mostrar `ok: true`, la ruta configurada y `soportesPdxFiles` > 0 si hay reportes.

No ejecute `git clean -fd` en el servidor sobre la carpeta de uploads persistente.

## 5) Chrome / Puppeteer (certificados y comprobantes PDF)

Si `UPLOADS_DIR` ya apunta a `private_uploads`, la app usa por defecto **`../private_puppeteer`** para guardar Chrome (misma carpeta padre que los uploads). Así el binario **no se borra** en cada redeploy.

Tras el primer deploy con esta versión:

1. Reinicie la Node.js App (el arranque intenta instalar Chrome si falta).
2. O ejecute `npm install` en el servidor (el `postinstall` también descarga Chrome).
3. Compruebe en `/api/health/deep` que `checks.chromium.ok` sea `true`.

Opcional en variables de entorno:

`PUPPETEER_CACHE_DIR=/home/USUARIO/domains/tudominio.com/private_puppeteer`

No use `CERTIFICADOS_PDF_MODE=html` en producción salvo emergencia: genera una página de impresión en lugar de PDF nativo.

## 6) Flujo recomendado de despliegue

1. Haz commit y push en Git.
2. En Hostinger, sincroniza/actualiza el repo.
3. Ejecuta `npm install` en el servidor (si no se ejecuta automatico). El `postinstall` descarga **Chrome** para Puppeteer (certificados/comprobantes PDF); la primera vez puede tardar varios minutos.
4. Reinicia la Node.js App desde hPanel.
5. Verifica:
   - `https://innarapp.neurocienciasnarino.com/api/health`
   - `https://innarapp.neurocienciasnarino.com/api/version`
   - `https://innarapp.neurocienciasnarino.com/`

## 6) Proxy inverso para `/socket.io/` (obligatorio contra 404)

Si el dominio entra por **Apache, LiteSpeed o Nginx** y Node escucha un **puerto interno**, esas peticiones **no llegan solas**: hay que configurar el proxy para **`/socket.io/`** y normalmente **`/api/`**.

### Paso A — Obtener el puerto de Node

En Hostinger: **Advanced → Node.js** (tu app): anota el **puerto** que usa el proceso (`PORT`; en este despliegue suele ser **7080**). El `.htaccess` debe usar **el mismo número** (`http://127.0.0.1:<PUERTO>` / `ws://127.0.0.1:<PUERTO>`).

### Paso B — Apache / LiteSpeed (`.htaccess`)

El bloque **«resto que no es fichero físico → proxy a Node»** hace que **`/` y rutas SPA las sirva Express**. Si dejas un `index.html` físico en `public_html`, Apache lo servirá y **no** pasará por Node (y el HTML inyectado puede quedar desfasado).

| Dónde apunta el dominio | Qué copiar / mantener |
|-------------------------|------------------------|
| Raíz del proyecto (donde está `server.js` y carpeta `public/`) | `.htaccess` de la **raíz** (`Options`, seguridad comprimidos de referencia **app-innar** + proxy). |
| Solo la carpeta **`public/`** | `public/.htaccess` (mismas reglas de proxy, adaptadas). |

Las reglas hacen (orden relevante):

1. **`/socket.io/`**: primero tentativas **WebSocket** (`ws://`), luego **`http://`** (polling / handshake HTTP), siempre **`%{REQUEST_URI}[QSA]`**.
2. **`/api/`** → **HTTP** proxy al mismo puerto Node.
3. **Rutas que no son archivo ni carpeta física** → proxy a Node (SPA y `/` desde Express).

En **hosting compartido**, la aplicación cliente y servidor usan **`polling` primero** y **WebSocket después** cuando el proxy lo permite (`transports`: polling + websocket): el handshake por **HTTP** atraviesa el `proxy_pass` / `[P]` con más fiabilidad que un upgrade WS aislado.

Si al guardar el `.htaccess` ves **500** al abrir `/socket.io/`, suele ser módulos desactivados: ticket a soporte pidiendo **`mod_proxy`**, **`mod_proxy_http`**, **`mod_proxy_wstunnel`**. Detalle sobre `[P]` e “alternativa sin mod_proxy”: **[HOSTINGER-MOD-PROXY.md](./HOSTINGER-MOD-PROXY.md)**.

**Importante:** el `.htaccess` tiene efecto sólo donde Apache lo lee (`public_html`, dominio, etc.). Si clonaste el repo pero el hosting sigue usando otra carpeta, **copia** este fichero al directorio correcto tras el deploy.

### Paso C — Nginx

Si tienes acceso al `server { }` (VPS), usa la plantilla **[NGINX-SOCKET.IO.md](./NGINX-SOCKET.IO.md)** (`location /socket.io/` + `proxy_pass` + `Upgrade` / `Connection`).

### Comprobación

- `https://tudominio/api/health` debe responder **200** (si no, el proxy de `/api/` o Node no está bien).
- Tras arreglar el proxy, el handshake de Socket.IO deja de devolver **404** generado por el estático/HTML del sitio.

## 7) Diagnostico rapido 403/503

### Si ves 403 en `/`

Respuesta típica de **Hostinger CDN** (`Server: hcdn` en las cabeceras, HTML genérico «Access to this resource on the server is denied!»):

1. **La app Node no está corriendo** (deploy fallido, p. ej. `postinstall` roto, o falta `SESSION_SECRET` / `DB_*`).
2. El dominio **no apunta a la Node.js App** (sigue en sitio estático / carpeta vacía).
3. Bloqueo en hPanel (IP, país, «Access Manager»).

Pasos en hPanel → **Advanced → Node.js**:

1. Abre **Logs** y busca errores de arranque o de `npm install`.
2. Pulsa **Restart** en la aplicación.
3. Confirma que `Application URL` = `innarapp.neurocienciasnarino.com` y `startup file` = `server.js`.
4. Tras un deploy, comprueba: `https://innarapp.neurocienciasnarino.com/api/health` debe devolver `{"ok":true,...}` (no 403).

Si el 403 lo genera **Apache** (sin `hcdn`, cuerpo distinto):

- El dominio no está pasando por Node.js App.
- O el servidor web sirve la carpeta raíz del repo sin `index.html` y con `Options -Indexes` (el `.htaccess` incluye regla que proxea `/` a Node).

Revisa que `Application URL` esté enlazada correctamente en Node.js App.

### Si ves 503

- La app no arranco o se cayo.
- Revisa logs de Node.js App en Hostinger.
- Verifica que no falten variables requeridas (`DB_*`, `SESSION_SECRET`).

## 8) Checklist final

- [ ] `npm run deploy:check` pasa en local
- [ ] `server.js` es el startup file
- [ ] Variables de entorno completas en Hostinger
- [ ] App reiniciada despues de pull/install
- [ ] `/api/health` responde `ok: true`
- [ ] Proxy: `.htaccess` (o Nginx) con **mismo puerto** que Node; `/socket.io/` y `/api/` reenviados (sin 404 del sitio estatico)
- [ ] No hay secretos reales versionados en Git
- [ ] `UPLOADS_DIR` apunta a carpeta persistente fuera del repo
- [ ] PDF de soportes copiados a `$UPLOADS_DIR/soportes` si hubo deploy previo

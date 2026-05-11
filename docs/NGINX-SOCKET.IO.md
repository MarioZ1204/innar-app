# Ejemplo Nginx → Node (Socket.IO + API)

En **Hostinger plan compartido / Node.js panel** suele usarse **Apache o LiteSpeed** y reglas en **`.htaccess`** (ver **[HOSTINGER-DEPLOY.md](./HOSTINGER-DEPLOY.md)** §5). Esta página aplica si administras un **VPS o Nginx** propio.

El **404 en** `/socket.io/?EIO=…` con la app funcionando indica que **Nginx recibe la URL** pero **`proxy_pass` no envía el tráfico al proceso Node** (puerto equivocado, `location` ausente o bloque que devuelve página estática/HTML).

En el repo, `server.js` ya hace `http.createServer(app)` y monta Socket.IO sobre ese **http.Server**, no sobre `app`.

## Comprobar proceso Node (PM2)

En el servidor Linux:

```bash
pm2 list
pm2 logs --lines 80
```

Si no aparece la app o está `errored`, ningún proxy arreglará el 404 hasta que Node escuche en el puerto configurado (p. ej. lo que definas en `.env` como `PORT`, frecuentemente inyectado por el panel).

## Bloque Nginx recomendado

Sustituye el puerto de ejemplo (**7080** en Hostinger habitual) por el **`PORT`** real de tu panel Node. Incluye `map` para WebSocket y `Connection` coherente:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name innarapp.neurocienciasnarino.com;

    # ... ssl_certificate, ssl_certificate_key ...

    # Handshake Engine.IO + WebSocket (sin esto → 404/HTML del sitio estático)
    location /socket.io/ {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:7080;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }

    location /api/ {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:7080;
    }

    # Opcional: SPA y estáticos pueden ir a Node o a `root` + try_files
    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass http://127.0.0.1:7080;
    }
}
```

Tras cambiar la config:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Diagnóstico rápido

- Desde el mismo servidor: `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:7080/api/health` (ajusta puerto) debe ser **200** si Node está arriba.
- Si eso falla, el problema es **Node/PM2/puerto**, no Nginx delante.

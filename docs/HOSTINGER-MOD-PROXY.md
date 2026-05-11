# mod_proxy y flag `[P]` en `.htaccess`

## 1. No hay “proxy por RewriteRule” sin módulo

En Apache, **`RewriteRule ... [P]`** (proxy) **requiere** que estén cargados **`mod_proxy`** y **`mod_proxy_http`**. Para WebSocket hacia `ws://` suele hacer falta también **`mod_proxy_wstunnel`**.

Un bloque como:

```apache
<IfModule mod_proxy.c>
  ProxyPreserveHost On
</IfModule>
```

**no activa** el módulo: solo evita error de sintaxis si el módulo **no** está presente. Si `mod_proxy` **no** está cargado, las reglas con **`[P]`** pueden **no proxear** (o provocar **500**), según la versión y el host.

**En hosting compartido Hostinger** no siempre puedes activar módulos tú mismo: si `/socket.io/` sigue en 404 o 500, pregunta a soporte si **`mod_proxy`**, **`mod_proxy_http`** y **`mod_proxy_wstunnel`** están habilitados para tu plan / vhost.

## 2. “Alternativa sin mod_proxy”

Cualquier variante que siga usando **`[P]`** **no** es una alternativa sin `mod_proxy`: es la misma dependencia con menos reglas.

Opciones reales **sin** reverse proxy delante de Node:

- Publicar la app **solo** con la **Node.js App** del panel (dominio enlazado al proceso Node sin Apache delante de `/socket.io/`).
- **VPS** donde controlas nginx / Apache y activas módulos.
- Que el proveedor configure el vhost por ti según tu plan.

## 3. Plantilla mínima con `[P]` (corregida)

Si confirmaste que `mod_proxy` funciona, puedes reducir reglas; **no uses `$1` hacia el backend** en `.htaccess`: usa **`%{REQUEST_URI}`** y **`QSA`** para no perder la query de Engine.IO (`?EIO=4&transport=...`).

```apache
RewriteEngine On

<IfModule mod_proxy.c>
  ProxyRequests Off
  ProxyPreserveHost On
</IfModule>

RewriteCond %{HTTPS} off
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

RewriteCond %{REQUEST_URI} ^/socket\.io/ [NC]
RewriteRule ^ http://127.0.0.1:7080%{REQUEST_URI} [P,L,QSA]

RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ http://127.0.0.1:7080%{REQUEST_URI} [P,L,QSA]
```

Para WebSocket estable, el `.htaccess` del repo anteponer reglas **`ws://`** para `/socket.io/` antes del `http://`.

## 4. Referencia

- [HOSTINGER-DEPLOY.md](./HOSTINGER-DEPLOY.md)

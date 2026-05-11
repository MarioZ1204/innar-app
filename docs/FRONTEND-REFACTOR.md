# Plan de modularización del frontend

## Estado actual (mayo 2026)

`public/app.js` está **minificado** (330 KB, una sola línea) y NO existe versión fuente
desminificada vigente en el repositorio. Como referencia histórica se guardó
`docs/legacy/app.pre-minify.js` (la versión más reciente antes de la minificación,
~534 KB, 11 317 líneas), pero **no refleja los ~130 commits de cambios posteriores
hechos directamente sobre el archivo minificado**.

Esto significa que cualquier modularización agresiva del archivo actual lo rompe.

## Estrategia adoptada

**Fase A — Andamiaje (HECHO en esta iteración)**

- `public/js/` con módulos ES nuevos: `state.js`, `api.js`, `ui-helpers.js`, `index.js`.
- `scripts/bundle.js` con `esbuild` para empaquetar los nuevos módulos.
- Script `npm run build:bundle`.
- `app-modules.js` se carga como `<script src="js/app-modules.js" defer>` (aún por enlazar
  cuando el bundle se construya por primera vez).

**Fase B — Rescate gradual del legacy (PENDIENTE, trabajo manual)**

1. Tomar `docs/legacy/app.pre-minify.js` como punto de partida.
2. Hacer `git log --follow -- public/app.js` desde `1bd7dbd` para identificar los cambios
   funcionales posteriores y aplicarlos manualmente sobre la fuente legible.
3. Una vez reconstruido `app.full.js` legible, dividirlo por dominio:
   - `public/js/auth.js` — login, hashPassword, sesión.
   - `public/js/recibos.js` — recibos CRUD, PDF, anulación, búsqueda.
   - `public/js/agenda.js` — calendario médico, turnos, disponibilidad.
   - `public/js/electro.js` — equipos, citas electro, UCQN, diagnósticos.
   - `public/js/pacientes.js` — pacientes en espera, búsqueda.
   - `public/js/usuarios.js` — gestión de usuarios, permisos.
   - `public/js/reportes.js` — reportes diarios/mensuales, dashboard.
   - `public/js/socket.js` — listeners unificados (deduplicar con `socket-electro.js`).
4. Cada dominio expone funciones puras + listeners. `index.js` los coordina.

**Fase C — Switchover**

- Probar en staging que el bundle (`js/app-modules.js`) tiene paridad funcional con
  `app.js` minificado.
- Reemplazar en `index.html` la etiqueta `<script src="app.js?v=...">` por
  `<script src="js/app-modules.js?v=..." defer>`.
- Mantener `app.js` accesible por una versión más para rollback rápido.

## Reglas para nuevos cambios (mientras dure la coexistencia)

- **Nuevas features** se implementan en `public/js/<modulo>.js` y se importan desde `index.js`.
- **Bug fixes urgentes** en código existente pueden seguir tocando `public/app.js`
  minificado (no hay alternativa hasta completar Fase B).
- **NUNCA** usar `eval`, `new Function`, ni `innerHTML` con datos de usuario. Usar
  `ui-helpers.escapeHtml`, `setText`, `el()`.

## XSS / handlers inline pendientes

**Eliminado en esta iteración:**
- `<script>` inline de splash (líneas ~2985-3049) → `public/splash.js` con `defer`.
- 2 handlers `onclick="...closest('.modal-overlay')..."` y
  `onclick="document.getElementById('modalDetallesCitaElectro')..."` → `data-close-modal`
  con delegación de eventos en `splash.js`.
- `document.write` en frontend: 0 ocurrencias detectadas (era falso positivo del plan).

**Pendientes en `index.html` (requieren funciones de `app.js` desminificado):**

| Línea | Atributo | Acción correctiva |
|-------|----------|-------------------|
| 75    | `onload="this.media='all'"` (Google Fonts) | Mover a `<link rel="preload" as="style">` |
| 737   | `onclick="toggleSlotVacio()"` | `id="btnToggleSlotVacio"` + addEventListener en `auth.js` |
| 1137  | `onclick="abrirBusquedaAuditoria()"` | id + addEventListener |
| 1171  | `onclick="cerrarTiposConsultaPanel()"` | id + addEventListener |
| 2134, 2139, 2141 | `oninput="actualizarHoraFinCalculada()"` | addEventListener |
| 2394  | `onclick="exportarAuditoriaCitasExcel()"` | id + addEventListener |
| 2397  | `onclick="exportarAuditoriaCitasPDF()"` | id + addEventListener |
| 2564  | `onclick="eliminarSeleccionadosGestion()"` | ya tiene id, sólo cambiar a addEventListener |
| 2611, 2673, 2689 | `onmouseover/onmouseout` cosméticos | mover a CSS `:hover` |
| 2620, 2624, 2639, 2643, 2650 | `onfocus/onblur` cosméticos | mover a CSS `:focus` |
| 2829  | `oninput="this.value=...replace(/\\D/g,'')..."` | utility `inputDigitsOnly` en `validation-client.js` |
| 3057, 3058 | `onclick="cerrarModalEditarServicio()/confirmarEditarServicio()"` | id + addEventListener |

Estimación: 1 día de trabajo manual una vez que `app.js` esté desminificado y los IDs/nombres sean estables.

## CSP

La CSP solo se puede endurecer (quitar `'unsafe-inline'` y `'unsafe-eval'`) cuando:
- Todos los `onclick=` inline en `index.html` se hayan migrado a `addEventListener` (ver tabla arriba).
- `app.js` no use `eval` ni `new Function` (verificar tras desminificación).
- Los estilos inline se hayan extraído a `style.css` (o se usen nonces).

Hoy `CSP_REPORT_ONLY=true` está activo. Endpoint `/api/csp-report` recoge violaciones.

### Variables de entorno CSP

| Variable | Default | Significado |
|----------|---------|-------------|
| `CSP_ENABLED` | `true` | Activa/desactiva CSP completa |
| `CSP_REPORT_ONLY` | `true` | `true` = solo loguea; `false` = bloquea |
| `CSP_STRICT` | `false` | `true` = remueve `'unsafe-inline'` y `'unsafe-eval'` de `scriptSrc` |

### Procedimiento de switchover

1. **Estado actual**: `CSP_REPORT_ONLY=true`, `CSP_STRICT=false`.
2. Migrar todos los handlers inline pendientes (tabla arriba) y verificar que `app.js` no use `eval`/`new Function`.
3. Cambiar a `CSP_STRICT=true` con `CSP_REPORT_ONLY=true` en producción y observar 48 h de logs.
4. Si `/api/csp-report` no recibe violaciones → cambiar `CSP_REPORT_ONLY=false`.
5. Si surgen violaciones → corregirlas (mover inline a archivos) y volver a punto 3.

## Sockets duplicados (deuda)

`public/socket-client.js` y `public/socket-electro.js` ambos escuchan
`electro:cita-creada`, `electro:cita-actualizada`, `electro:actualizar-lista`. Llaman
a `cargarCitasElectro()` desde dos lugares cuando llega un evento.

Ambos archivos están minificados; deduplicarlos requiere acceso a la fuente legible
(Fase B del rescate). Mientras tanto, `cargarCitasElectro` es idempotente y el
overhead es bajo (2 invocaciones en lugar de 1).

**Acción cuando se rescate**: dejar todos los listeners de dominio electro en
`socket-electro.js`; `socket-client.js` solo maneja conexión, reconexión, versión
y refresco genérico de módulo.

## defer

`public/splash.js` ya usa `defer`. **NO** se ha añadido `defer` a `app.js`,
`socket-client.js`, etc. porque están minificados y un cambio de timing podría
romper código que asume orden síncrono al final del `<body>`. Tras el rescate,
añadir `defer` a todos los `<script src=...>` y moverlos al `<head>`.

## Build

```
npm install --save-dev esbuild
npm run build:bundle              # build dev con sourcemaps
NODE_ENV=production npm run build:bundle  # build prod minificado
```

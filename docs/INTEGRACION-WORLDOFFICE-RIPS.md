# Integración World Office → RIPS (Innar Soportes)

Esta guía explica cómo **activar** la conexión cuando World Office entregue la API key, y qué debe coordinar con ellos.

## Qué hace Innar hoy (preparado, apagado por defecto)

- Recibe un **JSON RIPS** por API (sin login web).
- Lo guarda en la estructura de carpetas:

  `Mes → carpeta de día (facturados / a facturar) → RIPS → FE{número} → archivo.json`

- Puede **crear automáticamente** mes, carpeta de día, RIPS y carpeta FE si aún no existen (`WORLDOFFICE_RIPS_AUTO_CREATE=true`).

Sin API key en `.env`, el endpoint responde **503** con el mensaje de que la integración no está configurada.

---

## Paso 1 — Cuando World Office entregue la clave

1. Genere o reciba una clave segura (mínimo **16 caracteres**). Ejemplo:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. En el servidor Innar (`.env` en Hostinger o local), agregue:

   ```env
   WORLDOFFICE_RIPS_API_KEY=su_clave_secreta_aqui
   WORLDOFFICE_RIPS_ENABLED=true
   WORLDOFFICE_RIPS_AUTO_CREATE=true
   ```

3. **Reinicie** la aplicación Node (obligatorio para leer `.env`).

4. Opcional — restringir por IP (si World Office publica IP fija):

   ```env
   WORLDOFFICE_RIPS_IP_ALLOWLIST=203.0.113.10,198.51.100.2
   ```

---

## Paso 2 — Verificar que Innar quedó listo

Abra en el navegador o con `curl` (no requiere API key):

```http
GET https://su-dominio-innar/api/integraciones/worldoffice/status
```

Respuesta esperada cuando está bien configurado:

```json
{
  "configured": true,
  "enabled": true,
  "auto_create_estructura": true,
  "endpoint_ingesta": "POST /api/integraciones/worldoffice/rips"
}
```

Si `configured: false`, falta `WORLDOFFICE_RIPS_API_KEY` o el reinicio.

---

## Paso 3 — Contrato para World Office (envío del RIPS)

**URL:** `POST /api/integraciones/worldoffice/rips`  
**Base:** la misma URL de Innar (`https://innarapp...`)

**Autenticación** (una de las dos):

| Forma | Ejemplo |
|--------|---------|
| Header | `X-API-Key: su_clave` |
| Bearer | `Authorization: Bearer su_clave` |

**Headers:** `Content-Type: application/json`

**Cuerpo (JSON):**

| Campo | Obligatorio | Descripción |
|--------|-------------|-------------|
| `periodo` | Sí | Mes `YYYY-MM` (ej. `2026-05`) |
| `nombre_carpeta_dia` | Sí | Nombre visible (ej. `MAYO 1`, `MAYO 2-3`) |
| `estado_facturacion` | Sí | `facturados` o `a_facturar` |
| `codigo_fe` | Sí* | `FE12` |
| `numero_factura` | Sí* | Alternativa: `12` → se guarda como `FE12` |
| `contenido` | Sí | Objeto JSON del RIPS (el archivo en sí) |
| `nombre_archivo` | No | Ej. `FE12-rips.json` (por defecto `FE12-rips.json`) |
| `reemplazar` | No | `true` para sobrescribir si ya existe el mismo nombre |

\* Uno de `codigo_fe` o `numero_factura`.

**Ejemplo:**

```json
{
  "periodo": "2026-05",
  "nombre_carpeta_dia": "MAYO 1",
  "estado_facturacion": "facturados",
  "codigo_fe": "FE12",
  "contenido": {
    "numDocumentoIdObligado": "123456789",
    "usuarios": []
  },
  "nombre_archivo": "FE12-rips.json"
}
```

**Respuesta 201 (éxito):**

```json
{
  "ok": true,
  "message": "RIPS guardado en carpeta Soportes",
  "codigo_fe": "FE12",
  "ruta_relativa": "soportes/armado/2026-05/MAYO 1/FACTURADOS/RIPS/FE12/FE12-rips.json",
  "expediente_creado": true
}
```

**Errores frecuentes:**

| HTTP | Código | Significado |
|------|--------|-------------|
| 401 | `INVALID_API_KEY` | Clave incorrecta |
| 503 | `INTEGRATION_NOT_CONFIGURED` | Falta variable en `.env` |
| 404 | — | Mes/día/FE no existe y `AUTO_CREATE=false` |
| 409 | — | Archivo ya existe; enviar `reemplazar: true` |

---

## Paso 4 — Qué pedirle a World Office

1. Confirmen que pueden hacer **POST HTTPS** a su URL Innar (no solo export manual).
2. Pidan documentación del **esquema JSON RIPS** que exportan (para validaciones futuras).
3. Definan **quién manda** `nombre_carpeta_dia` y `estado_facturacion` (¿sale del lote de facturación?).
4. Acuerden si envían **un JSON por FE** o un lote (hoy Innar está preparado para **un FE por request**; lotes sería una ampliación).
5. Si usan IP fija, compartan la lista para `WORLDOFFICE_RIPS_IP_ALLOWLIST`.

---

## Paso 5 — Después de la primera prueba en producción

1. En Innar → **Soportes** → mes → carpeta de día → **RIPS** → debe aparecer la carpeta **FE{n}** y el `.json` en disco.
2. Revise en BD la tabla `sop_rips_archivos` (tras reinicio/migración runtime).
3. Guarde la API key **solo en el servidor**, nunca en el repositorio git.
4. Si World Office usa otra clave, cambie `.env` y reinicie.

---

## Prueba local (PowerShell) — cuando tenga la clave

```powershell
$headers = @{
  "X-API-Key" = "SU_CLAVE_AQUI"
  "Content-Type" = "application/json"
}
$body = @{
  periodo = "2026-05"
  nombre_carpeta_dia = "MAYO 1"
  estado_facturacion = "a_facturar"
  codigo_fe = "FE99"
  contenido = @{ prueba = $true; origen = "worldoffice" }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3000/api/integraciones/worldoffice/rips" -Method POST -Headers $headers -Body $body
```

---

## Archivos técnicos en el proyecto

| Archivo | Rol |
|---------|-----|
| `middleware/api-key.js` | Valida API key |
| `routes/integraciones-worldoffice.js` | Rutas HTTP |
| `utils/worldoffice-rips-ingest.js` | Lógica de carpetas y guardado |
| `migrations/runtime-migrations.js` | Tabla `sop_rips_archivos` |

## Pendiente (cuando tengan el JSON real de World Office)

- Validar esquema RIPS (campos obligatorios).
- Pantalla en Innar para **ver/descargar** JSON RIPS dentro de cada FE.
- Endpoint de **lote** si envían muchos FE en un solo POST.

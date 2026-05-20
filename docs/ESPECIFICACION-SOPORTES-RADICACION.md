# Especificación técnica — Soportes de radicación (Innar)

**Versión del documento:** 1.2  
**Fecha:** 2026-05-19  
**Estado:** Propuesta para implementación (formato PDX original + normalización interna + temas de carpeta por sinónimos)  
**Alcance:** Dos módulos independientes en frontend y backend compartiendo almacenamiento seguro de archivos.

---

## 1. Contexto y objetivo

### 1.1 Problema a resolver

En facturación se radican soportes en una plataforma externa. Ocurrió un error: se subió un **reporte PDX de electrodiagnóstico de otro mes** al paquete del mes que se estaba facturando, generando **glosa**.

### 1.2 Objetivo del sistema

1. **Depositar reportes PDX** por mes y modalidad de estudio, con búsqueda por nombre de paciente y trazabilidad de carpeta.
2. **Armar expedientes de soporte por factura** (`FE{número}`) con estructura mes → día → factura y slots OPF, CRC, FEV, PDX o HEV.
3. **Copiar/vincular** un PDX del módulo de reportes al expediente correcto sin manipular archivos fuera de Innar.
4. **Ventana operativa:** carpetas del **mes en curso** visibles durante el mes; el **mes anterior** sigue visible los **primeros 5 días** del mes siguiente; después pasa a **archivo** (oculto en vista principal, consultable por roles elevados).

### 1.3 Fuera de alcance (primera versión / MVP)

*“Primera versión”* = lo que se programa primero para usar en producción; lo demás queda para después.

- Generación automática de OPF/CRC desde historia clínica.
- Integración API con sistema de facturación electrónica (FEV): solo marcador “FEV en sistema externo” o slot opcional manual.
- Radicación automática a plataforma EPS.
- OCR automático de PDFs.

---

## 2. Arquitectura de módulos

```
┌─────────────────────────────────────────────────────────────────┐
│                         Menú principal                           │
├────────────────────────────┬────────────────────────────────────┤
│  Módulo A: reportes-pdx    │  Módulo B: armado-soportes         │
│  (Soportes PDX)            │  (Armado de soportes)              │
│                            │                                    │
│  • Carpetas creadas a mano │  • Mes manual / automático         │
│    (nombre libre + color)  │  • Días dentro del mes             │
│  • Solo PDF PDX            │  • FE{n} por factura               │
│  • Búsqueda por paciente   │  • Slots: OPF, CRC, FEV, PDX|HEV   │
│  • Copiar → FE{n}         │  • Importar PDX desde Módulo A     │
└────────────────────────────┴────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  uploads/soportes/ (disco)     │
              │  + tablas MySQL (metadatos)    │
              │  + routes/soportes.js (API)    │
              │  + auth en routes/uploads.js   │
              └───────────────────────────────┘
```

| Código documento | Contenido | Módulo |
|------------------|-----------|--------|
| PDX | Reporte electrodiagnóstico | A (origen), B (destino en slot PDX) |
| OPF | Orden + Historia + Autorización | B |
| CRC | Comprobante + Certificado | B |
| FEV | Factura electrónica | B (externo / checkbox) |
| HEV | Evolución consulta | B (slot alternativo a PDX) |

**Regla:** En un mismo `FE{n}` solo **PDX o HEV**, nunca ambos.

---

## 3. Reglas de negocio

### 3.1 Visibilidad temporal

Constantes (configurables en código o tabla `config_sistema`):

| Parámetro | Valor default |
|-----------|---------------|
| `SOPORTES_GRACE_DAYS` | `5` |
| Zona horaria | `America/Bogota` (o la del servidor) |

**Función `getVisibilidadCarpeta(periodoYYYYMM, fechaHoy)`**

- `periodo` = mes calendario de la carpeta (`2025-03`).
- **Activa:** `periodo === mes(fechaHoy)`.
- **Gracia:** `periodo === mesAnterior(fechaHoy)` **y** `díaDelMes(fechaHoy) <= 5`.
- **Archivo:** cualquier otro caso.

**UI:**

- Lista principal: solo carpetas `activa` + `gracia` (con badge “Cierre en X días” en gracia).
- Sección colapsable “Archivo” o pantalla aparte: solo `soportes.ver_archivo` + rol admin.

### 3.2 Carpetas PDX (Módulo A)

**No hay lista fija de modalidades (VTM, PSG, etc.).** El usuario **crea carpetas con el nombre que quiera**, por ejemplo:

- `REPORTES MES MARZO VTM`
- `REPORTES MES MARZO PSG`
- `REPORTES MES MARZO EEG`

Así evitan confusiones y pueden duplicar el criterio que ya usan en el equipo.

**Color de carpeta (solo visual):** el sistema **clasifica el nombre de la carpeta** (no el contenido de los PDFs) con sinónimos, igual que en electro. Una carpeta puede llamarse `REPORTES MES MARZO VTM` o `REPORTES MES MARZO Monitorización Electroencefalográfica de Video y Radio` y recibir el **mismo color azul**.

Función `detectarTemaCarpeta(nombre)` → `vtm` | `psg` | `eeg` | `actigrafia` | `neutral` (prioridad: VTM → PSG → EEG → actigrafía si hay varias coincidencias, configurable).

| Tema | Color UI | Palabras / frases reconocidas (sin tildes, contains) |
|------|----------|------------------------------------------------------|
| **vtm** | Azul | `vtm`, `videotelemetria`, `video telemetria`, `telemetria`, `monitorizacion` + (`video` o `radio` o `eeg`), `monit.` + `eeg` + `video` |
| **psg** | Morado | `psg`, `polisomnog`, `polisomnografia`, `polisomnograma`, `basal`, `titulacion`, `cpap`, `bpap` (si no es solo consulta) |
| **eeg** | Amarillo | `eeg`, `electroencefalog`, `electroencefalograma` (sin monitorización de video) |
| **actigrafia** | Cian | `actigraf`, `actigrafia` |
| **neutral** | Gris | ninguna coincidencia |

La etiqueta mostrada en la tarjeta sigue siendo el **nombre exacto** que creó el usuario; el color solo ayuda a ubicarse.

**Periodo:** cada carpeta pertenece a un mes `YYYY-MM` (para visibilidad y gracia de 5 días).

**Botón “Nueva carpeta”:** nombre libre + mes (por defecto mes visible).

### 3.2.1 Formato de nombre de archivo PDX (convención real)

**Los usuarios suben el PDF con el nombre que genera el equipo** (no tienen que renombrar manualmente). Innar **acepta el nombre original** y **normaliza por dentro** para búsqueda y pantalla.

Ejemplo de entrada (tal cual lo suben):

```text
Arcos Enriquez, Nancy Del Carmen  2026-03-14 21-21-12 1. PSG BASAL.pdf
```

**Almacenamiento:**

| Campo | Contenido |
|-------|-----------|
| `nombre_archivo_original` | Nombre exacto del archivo subido (auditoría) |
| `nombre_archivo_display` | Versión normalizada para listados (opcional renombrar en disco o solo en BD) |
| Metadatos parseados | apellidos, nombres, fecha, marca_tiempo, sufijo, estudio_texto |

**Estructura interpretada por Innar:**

| Parte | Ejemplo | Notas |
|-------|---------|--------|
| Apellidos | `Arcos Enriquez` | Antes de la primera coma |
| Nombres | `Nancy Del Carmen` | Después de la coma |
| Fecha del estudio | `2026-03-14` | `YYYY-MM-DD` |
| Marca de tiempo | `21-21-12` | Se guarda tal cual; en UI puede mostrarse como hora si tiene forma `HH-mm-ss` |
| Sufijo numérico | `1` | Tras la marca de tiempo, antes de `.` |
| Tipo de estudio | `PSG BASAL` | Tras `N. ` (ej. `1. PSG BASAL`) |

**Normalización interna** (`normalizarNombrePdx(original)`):

```text
Arcos Enriquez - Nancy Del Carmen - 2026-03-14 - 21-21-12 - 1. PSG BASAL.pdf
```

- El archivo en disco puede conservar el **nombre original** (recomendado) o copiarse con nombre normalizado; en ambos casos la BD guarda ambos strings.
- Si el parser falla: modal corto para confirmar apellidos, nombres, fecha y estudio (obligatorio).

**Parser (regex principal + fallback):**

```javascript
// Principal: "Apellido, Nombre  YYYY-MM-DD HH-mm-ss N. ESTUDIO"
const RE_PDX_FILENAME = /^(.+?),\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+([\d-]+)\s+(\d+)\.\s*(.+?)\.pdf$/i;

function normalizarNombrePdx(parsed) {
  const { apellidos, nombres, fecha, marcaTiempo, sufijo, estudio } = parsed;
  return `${apellidos} - ${nombres} - ${fecha} - ${marcaTiempo} - ${sufijo}. ${estudio}.pdf`;
}
```

**Validación al subir:**

- Extensión `.pdf`.
- Parser exitoso **o** confirmación manual.
- **Alerta roja** si `fecha_estudio` (del nombre) no cae en el `periodo` de la carpeta destino (mes incorrecto).
- **Aviso amarillo** si el texto de estudio no coincide con el “tema” de la carpeta (ej. archivo `PSG BASAL` en carpeta cuyo nombre detecta tema `vtm`) — no bloquea, solo advierte.

**Búsqueda:** apellidos, nombres, nombre completo, `estudio_texto`, fecha, y nombre original.

**Chip de estudio en lista:** opcionalmente `detectarTemaCarpeta(estudio_texto)` para mini-badge de color coherente con la carpeta.

### 3.3 Armado de soportes (Módulo B)

**Jerarquía:**

```text
soportes_mes/{YYYY-MM}/           → registro `soportes_periodos`
  {DD}/                           → registro `soportes_dias` (01-31)
    FE{numero}/                   → registro `soportes_expedientes`
      OPF/ CRC/ FEV/ PDX|HEV/     → slots en `soportes_expediente_archivos`
```

**Creación del primer `FE{n}`:** formulario manual: número factura, paciente (nombre + documento), tipo servicio (`electro` | `consulta`), día (fecha).

**Botón “Añadir carpeta de factura” (consecutivo FE):** ver glosario §14. Toma el **mayor número de factura** ya creado en ese **mes** + 1 y arma el código `FE{n}`.

Ejemplo: en marzo ya existen `FE12340` y `FE12341` → al pulsar “Añadir”, el sistema propone **`FE12342`**. La persona puede corregirlo si en la realidad saltó un número. Así no tienen que recordar el último número a mano.

**FEV:** campo `fev_gestion_externa` TINYINT default 1; slot FEV opcional para PDF si en el futuro suben copia; v1 puede ser solo checkbox “FEV verificada en sistema de facturación”.

### 3.4 Copia PDX → expediente

- Operación **servidor** (copy file + nuevo registro), no clipboard del SO.
- Origen: `pdx_archivos.id`.
- Destino: `soportes_expedientes.id`, slot `PDX`.
- Validaciones:
  - Expediente debe tener `tipo_servicio = electro`.
  - **Advertencia fuerte** si `periodo_origen !== periodo_destino` (mes carpeta PDX vs mes carpeta armado).
  - Si slot PDX ya tiene archivo: confirmar reemplazo.

Auditoría en `soportes_transferencias`.

### 3.5 Normalización de nombres (búsqueda)

```javascript
function normalizarNombreBusqueda(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- Al subir PDX se guarda `paciente_nombre_extraido` (parser del filename o valor elegido).
- Búsqueda: `LIKE` sobre nombre normalizado o FULLTEXT (v2).

---

## 4. Modelo de datos (MySQL)

Prefijo de tablas: `sop_` (soportes). Migración runtime `rt_soportes_radicacion`.

### 4.1 Diagrama entidad-relación (resumen)

```text
sop_pdx_carpetas 1 ── * sop_pdx_archivos
sop_periodos 1 ── * sop_dias 1 ── * sop_expedientes 1 ── * sop_exp_archivos
sop_pdx_archivos * ── * sop_expedientes  vía sop_transferencias
```

### 4.2 DDL propuesto

```sql
-- Modalidad de reportes PDX
CREATE TABLE sop_pdx_carpetas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periodo CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  nombre_display VARCHAR(160) NOT NULL COMMENT 'Ej: REPORTES MES MARZO VTM',
  color_tema VARCHAR(20) NULL COMMENT 'vtm|psg|eeg|actigrafia|neutral — derivado del nombre',
  estado_visibilidad ENUM('activa','gracia','archivo') NOT NULL DEFAULT 'activa',
  creado_por INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sop_pdx_periodo_nombre (periodo, nombre_display),
  INDEX idx_sop_pdx_periodo (periodo),
  INDEX idx_sop_pdx_vis (estado_visibilidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sop_pdx_archivos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  carpeta_id INT NOT NULL,
  apellidos VARCHAR(120) NULL,
  nombres VARCHAR(120) NULL,
  paciente_nombre VARCHAR(200) NOT NULL COMMENT 'nombre completo display',
  paciente_nombre_norm VARCHAR(220) NOT NULL,
  paciente_documento VARCHAR(30) NULL,
  fecha_estudio DATE NULL COMMENT 'extraída del nombre del archivo',
  marca_tiempo VARCHAR(40) NULL COMMENT 'ej: 21-21-12',
  sufijo_numero VARCHAR(10) NULL COMMENT 'ej: 1',
  estudio_texto VARCHAR(120) NULL COMMENT 'ej: PSG BASAL',
  nombre_archivo_original VARCHAR(255) NOT NULL,
  nombre_archivo_display VARCHAR(255) NULL COMMENT 'normalizado con guiones',
  ruta_relativa VARCHAR(500) NOT NULL COMMENT 'soportes/pdx/{carpeta_id}/... nombre original en disco',
  mime_type VARCHAR(80) DEFAULT 'application/pdf',
  tamano_bytes INT UNSIGNED NOT NULL,
  subido_por INT NULL,
  cita_electro_id INT NULL COMMENT 'opcional v2',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sop_pdx_carpeta FOREIGN KEY (carpeta_id) REFERENCES sop_pdx_carpetas(id) ON DELETE CASCADE,
  INDEX idx_sop_pdx_nom (paciente_nombre_norm),
  INDEX idx_sop_pdx_doc (paciente_documento),
  INDEX idx_sop_pdx_carpeta (carpeta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Período mensual de armado (un registro por mes)
CREATE TABLE sop_periodos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periodo CHAR(7) NOT NULL UNIQUE,
  etiqueta VARCHAR(80) NOT NULL COMMENT 'MARZO 2025',
  estado_visibilidad ENUM('activa','gracia','archivo') NOT NULL DEFAULT 'activa',
  creado_por INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sop_per_vis (estado_visibilidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sop_dias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  periodo_id INT NOT NULL,
  dia TINYINT UNSIGNED NOT NULL COMMENT '1-31',
  fecha DATE NOT NULL COMMENT 'fecha calendario armada',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sop_dia (periodo_id, dia),
  CONSTRAINT fk_sop_dia_periodo FOREIGN KEY (periodo_id) REFERENCES sop_periodos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sop_expedientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dia_id INT NOT NULL,
  codigo VARCHAR(32) NOT NULL COMMENT 'FE12345',
  numero_factura INT UNSIGNED NOT NULL,
  paciente_nombre VARCHAR(200) NOT NULL,
  paciente_documento VARCHAR(30) NULL,
  tipo_servicio ENUM('electro','consulta') NOT NULL,
  fev_externa_verificada TINYINT(1) NOT NULL DEFAULT 0,
  listo_radicacion TINYINT(1) NOT NULL DEFAULT 0,
  notas TEXT NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sop_exp_codigo (dia_id, codigo),
  INDEX idx_sop_exp_factura (numero_factura),
  INDEX idx_sop_exp_pac (paciente_documento),
  CONSTRAINT fk_sop_exp_dia FOREIGN KEY (dia_id) REFERENCES sop_dias(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sop_exp_archivos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  expediente_id INT NOT NULL,
  tipo ENUM('OPF','CRC','FEV','PDX','HEV') NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  ruta_relativa VARCHAR(500) NOT NULL,
  mime_type VARCHAR(80) DEFAULT 'application/pdf',
  tamano_bytes INT UNSIGNED NOT NULL,
  origen ENUM('upload','copia_pdx') NOT NULL DEFAULT 'upload',
  pdx_archivo_id INT NULL,
  subido_por INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sop_exp_tipo (expediente_id, tipo),
  CONSTRAINT fk_sop_exp_arch_exp FOREIGN KEY (expediente_id) REFERENCES sop_expedientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_sop_exp_arch_pdx FOREIGN KEY (pdx_archivo_id) REFERENCES sop_pdx_archivos(id) ON DELETE SET NULL,
  INDEX idx_sop_exp_arch_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sop_transferencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pdx_archivo_id INT NOT NULL,
  expediente_id INT NOT NULL,
  slot_tipo ENUM('PDX') NOT NULL DEFAULT 'PDX',
  usuario_id INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sop_trf_pdx (pdx_archivo_id),
  INDEX idx_sop_trf_exp (expediente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.3 Actualización de visibilidad

Job al cargar listados (sin cron v1):

```javascript
async function refrescarVisibilidadPeriodo(periodo, hoy) {
  const estado = calcularVisibilidad(periodo, hoy);
  await db.execute(
    'UPDATE sop_pdx_carpetas SET estado_visibilidad = ? WHERE periodo = ?',
    [estado, periodo]
  );
  await db.execute(
    'UPDATE sop_periodos SET estado_visibilidad = ? WHERE periodo = ?',
    [estado, periodo]
  );
}
```

---

## 5. Almacenamiento en disco

Base: `public/uploads/soportes/` (misma raíz que uploads actuales; **no** servir por `express.static`; solo vía API autenticada).

```text
uploads/soportes/
  pdx/
    2025-03/
      VTM/
        1745123456-GARCIA_JUAN.pdf
      PSG/
      EEG/
      ACTIGRAFIA/
  armado/
    2025-03/
      15/
        FE12345/
          OPF/
          CRC/
          FEV/
          PDX/
```

**Límite tamaño:** 15 MB por PDF (armado puede tener varios archivos por slot; OPF puede ser multi-página).

**MIME:** solo PDF en v1 (`validateMagicBytes` existente).

---

## 6. API REST

Archivo nuevo: `routes/soportes.js`. Montaje en `server.js`: `app.use('/api', require('./routes/soportes'));`

Helpers: `utils/soportes-visibilidad.js`, `utils/soportes-nombres.js`.

### 6.1 Módulo PDX — Reportes

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/soportes/pdx/carpetas` | Lista carpetas visibles (+ archivo si permiso) |
| POST | `/api/soportes/pdx/carpetas` | Crear carpeta `{ periodo, nombre_display }` |
| GET | `/api/soportes/pdx/carpetas/:id/archivos` | Lista PDFs de una carpeta |
| POST | `/api/soportes/pdx/carpetas/:id/archivos` | Subida `multipart/form-data` + `paciente_nombre` |
| GET | `/api/soportes/pdx/buscar?q=` | Búsqueda global en carpetas visibles |
| DELETE | `/api/soportes/pdx/archivos/:id` | Elimina (soft delete opcional v2) |
| GET | `/api/soportes/pdx/archivos/:id/descargar` | Stream PDF |

### 6.2 Módulo Armado

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/soportes/armado/periodos` | Lista meses |
| POST | `/api/soportes/armado/periodos` | Crear mes `{ periodo, etiqueta }` |
| GET | `/api/soportes/armado/periodos/:id/dias` | Días con conteo FE |
| POST | `/api/soportes/armado/periodos/:id/dias` | Crear día `{ dia, fecha }` |
| GET | `/api/soportes/armado/dias/:id/expedientes` | Lista `FE{n}` |
| POST | `/api/soportes/armado/dias/:id/expedientes` | Crear FE manual |
| POST | `/api/soportes/armado/dias/:id/expedientes/siguiente` | Crear FE con consecutivo |
| GET | `/api/soportes/armado/expedientes/:id` | Detalle slots |
| POST | `/api/soportes/armado/expedientes/:id/archivos` | Subir OPF/CRC/FEV/HEV |
| PATCH | `/api/soportes/armado/expedientes/:id` | Actualizar paciente, FEV verificada, listo |
| POST | `/api/soportes/armado/expedientes/:id/importar-pdx` | Body `{ pdx_archivo_id }` |
| GET | `/api/soportes/armado/expedientes/:id/zip` | Descarga ZIP del expediente |
| GET | `/api/soportes/armado/periodos/:id/zip` | ZIP masivo opcional v2 |

### 6.3 Respuestas tipo

**Carpeta PDX:**

```json
{
  "id": 12,
  "periodo": "2025-03",
  "nombre_display": "REPORTES MES MARZO VTM",
  "color_tema": "vtm",
  "estado_visibilidad": "activa",
  "archivos_count": 48,
  "dias_restantes_gracia": null
}
```

**Búsqueda PDX:**

```json
{
  "resultados": [
    {
      "archivo_id": 901,
      "paciente_nombre": "Juan García López",
      "carpeta_id": 12,
      "carpeta_nombre": "REPORTES MES MARZO VTM",
      "periodo": "2025-03",
      "modalidad": "VTM",
      "nombre_archivo": "GARCIA_JUAN_PSG.pdf",
      "creado_en": "2025-03-18T14:22:00"
    },
    {
      "archivo_id": 450,
      "paciente_nombre": "Juan García López",
      "carpeta_id": 8,
      "carpeta_nombre": "REPORTES MES FEBRERO PSG",
      "periodo": "2025-02",
      "modalidad": "PSG"
    }
  ]
}
```

**Expediente:**

```json
{
  "id": 33,
  "codigo": "FE12345",
  "tipo_servicio": "electro",
  "slots": {
    "OPF": { "completo": true, "archivo_id": 1 },
    "CRC": { "completo": true, "archivo_id": 2 },
    "FEV": { "completo": false, "externa_verificada": true },
    "PDX": { "completo": true, "archivo_id": 5, "origen": "copia_pdx" },
    "HEV": { "completo": false, "habilitado": false }
  },
  "paquete_completo": true
}
```

---

## 7. Permisos

Nuevas claves en `PERMISOS_DEFS` (`public/app.js`):

| Clave | Descripción |
|-------|-------------|
| `modulo.reportes_pdx` | Acceso módulo A |
| `modulo.armado_soportes` | Acceso módulo B |
| `soportes.pdx.subir` | Subir PDF en carpetas PDX |
| `soportes.pdx.eliminar` | Eliminar PDF PDX |
| `soportes.pdx.buscar` | Buscar (implícito con módulo) |
| `soportes.armado.crear_estructura` | Crear mes/día/FE |
| `soportes.armado.subir` | Subir OPF/CRC/HEV/FEV |
| `soportes.armado.importar_pdx` | Copiar PDX → FE |
| `soportes.ver_archivo` | Ver meses en estado archivo |
| `soportes.descargar_zip` | Export ZIP |

**Roles default sugeridos:**

| Rol | Módulo A | Módulo B |
|-----|----------|----------|
| superadmin, admin | todo | todo |
| contabilidad, recepcion, admin_recepcion | subir + buscar | crear + subir + importar |
| electro, tecnico_electro | subir PDX | — |

Mapa menú (`MODULE_PERM_MAP`):

```javascript
'reportes-pdx': 'modulo.reportes_pdx',
'armado-soportes': 'modulo.armado_soportes',
```

---

## 8. Frontend (Innar)

### 8.1 Rutas de módulo

| `data-module` | Vista HTML | JS init |
|---------------|------------|---------|
| `reportes-pdx` | `#view-reportes-pdx` | `initReportesPdx()` |
| `armado-soportes` | `#view-armado-soportes` | `initArmadoSoportes()` |

Estilos: prefijo CSS `sop-` en `public/style.css` o `public/soportes.css` (carga en index).

### 8.2 Módulo A — UI

**Pantalla 1 — Inicio**

- Grid de tarjetas por carpeta (`nombre_display`, badge modalidad, contador archivos).
- Chip de estado: “Mes actual” / “Cierra en 3 días”.
- FAB o botón “Subir reportes” deshabilitado hasta elegir carpeta.
- **Buscador global** sticky: input + resultados en dropdown/panel.

**Pantalla 2 — Detalle carpeta**

- Breadcrumb: `Reportes PDX > REPORTES MES MARZO VTM`.
- Zona drag-and-drop PDF.
- Tabla: paciente, archivo, fecha, usuario, acciones (descargar, enviar a soporte).
- Filtro local por texto.

**Modal “Enviar a soporte de factura”**

1. Select período armado (solo visibles).
2. Select día.
3. Select expediente `FE{n}` (filtro por paciente opcional).
4. Confirmar → POST `importar-pdx`.
5. Toast éxito + enlace abrir expediente.

**Búsqueda con duplicados**

Cada fila muestra badge de carpeta distinto; mismo paciente en 2 carpetas = 2 filas (requisito explícito).

### 8.3 Módulo B — UI

**Layout:** master-detail 3 columnas (responsive: stack en móvil).

| Columna | Contenido |
|---------|-----------|
| Izq | Meses → días (lista con badge # FE) |
| Centro | Lista expedientes del día (`FE12345`, paciente, chips slots) |
| Der | Detalle expediente + upload por slot |

**Crear primer FE:** modal campos: número, paciente, documento, tipo servicio, día.

**Añadir FE:** botón; preview `FE{sugerido}` editable.

**Slots:** 4 cards (OPF, CRC, FEV, HEV/PDX según tipo). FEV card con toggle “Verificada en sistema externo”. PDX card con botón “Importar desde reportes”.

**Indicadores visuales:** barra progreso 3/4 documentos; check verde cuando `paquete_completo`.

### 8.4 Diseño visual (tokens)

Reutilizar familia `meq-` / variables existentes:

| Modalidad | Color |
|-----------|-------|
| VTM | `#2563eb` |
| PSG | `#7c3aed` |
| EEG | `#ca8a04` |
| ACTIGRAFIA | `#0891b2` |

Tipografía y bordes redondeados 12–14px como monitor de equipos; iconos SVG inline (sin dependencias nuevas).

---

## 9. Seguridad y auditoría

- Todos los endpoints: `requireAuth` + `requireRoleOrPerm`.
- Descarga archivos: extender `routes/uploads.js` o ruta dedicada `GET /api/soportes/archivo/:id` que valide permiso y path bajo `uploads/soportes/`.
- Path traversal: validar `ruta_relativa` sin `..`.
- Registrar en `auditoria` (tabla existente) eventos: `sop_pdx_subida`, `sop_exp_creado`, `sop_pdx_copiado`, `sop_exp_listo`.
- CSRF: mismas reglas que resto de API (`apiFetch` con token).

---

## 10. Integración futura (v2)

| Feature | Beneficio |
|---------|-----------|
| Vincular `cita_electro_id` al subir PDX | Alerta si fecha cita ≠ periodo carpeta |
| Autocompletar paciente desde `pacientes` | Menos errores de nombre en archivo |
| OCR fecha en PDF | Validación automática mes |
| Notificación día 4 de gracia | Email interno |
| Dashboard faltantes | OPF/CRC/PDX por FE incompletos |

---

## 11. Plan de implementación

| Fase | Entregable | Estimación relativa |
|------|------------|---------------------|
| **F1** | Migración SQL + `utils/soportes-*` + API PDX + vista A | Base |
| **F2** | API armado + vista B (mes/día/FE/slots) | Base |
| **F3** | Importar PDX + búsqueda global + ZIP expediente | Integración |
| **F4** | Archivo histórico + permisos + auditoría | Cierre |
| **F5** | Pulido UI, pruebas, documentación RUNBOOK | QA |

**Versión app objetivo:** `1.4.0` (feature mayor).

### 11.1 Archivos nuevos/modificados (checklist dev)

```
routes/soportes.js
utils/soportes-visibilidad.js
utils/soportes-nombres.js
utils/soportes-storage.js
migrations/runtime-migrations.js  (+ rt_soportes_radicacion)
public/index.html                 (+ 2 views + menu cards)
public/style.css                  (+ .sop-*)
public/app.js                     (+ init*, PERMISOS_DEFS, MODULE_PERM_MAP)
docs/legacy/app.pre-minify.js     (sync si aplica)
server.js                         (mount route)
package.json                      (version bump)
```

---

## 12. Criterios de aceptación

1. Usuario con permiso puede subir PDF a carpeta `REPORTES MES {actual} {MOD}` solo si la carpeta está visible.
2. Archivo sin nombre de paciente reconocible muestra error o flujo de selección de paciente.
3. Búsqueda “García” devuelve resultados en 2 carpetas con etiquetas distintas de carpeta.
4. Copiar PDX a `FE12345` deja el PDF en slot PDX y registra transferencia.
5. No se puede tener PDX y HEV completos simultáneamente en el mismo FE.
6. Consecutivo `FE` sugiere número anterior + 1 del mismo mes.
7. Del día 1 al 5 del mes siguiente, carpetas del mes anterior siguen en lista con aviso de gracia.
8. Del día 6 en adelante, mes anterior solo visible con `soportes.ver_archivo`.
9. FEV puede marcarse verificada sin archivo adjunto.
10. Descarga ZIP de un expediente contiene carpetas OPF, CRC, PDX (o HEV) con archivos correctos.

---

## 13. Preguntas abiertas (decisión producto)

| # | Pregunta | Estado |
|---|----------|--------|
| 1 | ¿Consecutivo FE por mes o por día? | **Por mes** (ver §14) |
| 2 | ¿Modalidades fijas? | **No** — carpetas con nombre libre + color por detección |
| 3 | ¿Qué significa exactamente `21-21-12`? | Pendiente confirmación con electro; se almacena tal cual |
| 4 | ¿Un OPF = un PDF o varios? | Primera versión: **un PDF por slot**; después varios |
| 5 | ¿Eliminar PDF PDX después de copiar a FE? | Solo admin (por definir) |

---

## 14. Glosario (lenguaje no técnico)

| Término | Significado |
|---------|-------------|
| **FE** | Carpeta de **factura** en el módulo de armado. Nombre tipo `FE12345` = factura electrónica / factura interna n.º 12345. Ahí van OPF, CRC, FEV y PDX juntos. |
| **Consecutivo FE** | Al crear la siguiente carpeta de factura, Innar propone el **siguiente número** (`FE12346` después de `FE12345`) para no equivocarse ni repetir. |
| **PDX** | PDF del **reporte** de electrodiagnóstico. |
| **Primera versión (MVP)** | Primera entrega del programa: lo esencial para trabajar; mejoras posteriores (varios PDF por slot, OCR, etc.) van en **fases siguientes**. No es “versión 1 del archivo”, es “fase 1 del proyecto”. |
| **Slot** | Hueco por tipo de documento dentro de un `FE` (OPF, CRC, FEV, PDX o HEV). |

---

*Documento listo para desarrollo. Siguiente paso: confirmar significado de `21-21-12` con el área de electro e iniciar F1 (migración + API PDX).*

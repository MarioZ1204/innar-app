-- ============================================================
-- INNAR APP — Patch B: Correcciones de Integridad de Base de Datos
-- Base de datos: u485192928_innar_app (producción Hostinger)
-- MariaDB 11.8.6-MariaDB-log
-- Generado: 2026-05-08
--
-- APLICAR EN ORDEN. Ejecutar completo en una sola sesión.
-- Hacer respaldo antes de ejecutar.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_SAFE_UPDATES   = 0;

-- ============================================================
-- SECCIÓN 1: DIAGNÓSTICOS — Corregir Ñ corrompida (— → Ñ)
-- Afecta: MIGRAÑA, SUEÑO, PEQUEÑO y derivados
-- Causa: error de charset en importación inicial (2026-03-12)
-- ============================================================

UPDATE diagnosticos
SET    nombre = REPLACE(nombre, '—', 'Ñ')
WHERE  nombre LIKE '%—%';

-- Verificación:
-- SELECT id, nombre FROM diagnosticos WHERE nombre LIKE '%Ñ%' ORDER BY id;


-- ============================================================
-- SECCIÓN 2: TURNOS ZOMBI — Cerrar turnos activos de marzo
-- Afecta: IDs 4, 5, 6, 8, 9, 10 (fecha 2026-03-14, >50 días abiertos)
-- ============================================================

UPDATE turnos
SET    estado = 'COMPLETADO'
WHERE  estado IN ('EN_SALA', 'EN_ATENCION')
  AND  fecha < '2026-04-01';

-- Verificación:
-- SELECT id, fecha, paciente_nombre, estado FROM turnos WHERE id IN (4,5,6,8,9,10);


-- ============================================================
-- SECCIÓN 3: CITAS ELECTRO — Cancelar 'Programado' sin equipo
-- Afecta: citas vencidas (>14 días) sin equipo_id asignado
-- No toca citas recientes ni las que ya tienen equipo
-- ============================================================

UPDATE citas_electro
SET    estado = 'Cancelado'
WHERE  estado     = 'Programado'
  AND  equipo_id IS NULL
  AND  fecha     < DATE_SUB(CURDATE(), INTERVAL 14 DAY)
  AND  deleted_at IS NULL;

-- Verificación:
-- SELECT id, fecha, estudio, estado FROM citas_electro
-- WHERE estado = 'Programado' AND equipo_id IS NULL;


-- ============================================================
-- SECCIÓN 4: CITAS ELECTRO — Corregir hora_fin_date en estudios nocturnos
-- Afecta: estudios que cruzan medianoche donde hora_fin < hora_inicio
-- pero hora_fin_date quedó igual que fecha (debería ser fecha + 1 día)
-- ============================================================

UPDATE citas_electro
SET    hora_fin_date = DATE_ADD(fecha, INTERVAL 1 DAY)
WHERE  hora_inicio  IS NOT NULL
  AND  hora_fin     IS NOT NULL
  AND  hora_fin      < hora_inicio
  AND  hora_fin_date = fecha
  AND  deleted_at   IS NULL;

-- Verificación:
-- SELECT id, fecha, hora_inicio, hora_fin, hora_fin_date FROM citas_electro
-- WHERE hora_fin < hora_inicio ORDER BY fecha;


-- ============================================================
-- SECCIÓN 5: DIAS_BLOQUEADOS — Corregir UNIQUE solo por fecha
-- Error: UNIQUE KEY `fecha` (fecha) — permite 1 sola fecha en toda la tabla
-- Corrección: UNIQUE por (fecha, doctor_id) — 1 fecha por doctor
-- SEGURO: la tabla está vacía actualmente
-- ============================================================

ALTER TABLE dias_bloqueados
  DROP INDEX `fecha`;

ALTER TABLE dias_bloqueados
  ADD UNIQUE KEY `unique_fecha_doctor` (`fecha`, `doctor_id`);

-- Verificación:
-- SHOW INDEX FROM dias_bloqueados WHERE Key_name = 'unique_fecha_doctor';


-- ============================================================
-- SECCIÓN 6: DOCTOR_AGENDA — Eliminar fecha de prueba 2026-12-01
-- Afecta: IDs 70, 71 — doctor_id=17 (JoseZL), fecha futura probable error
-- ============================================================

DELETE FROM doctor_disponibilidad_mensual
WHERE  fecha     = '2026-12-01'
  AND  doctor_id = 17;

DELETE FROM doctor_agenda
WHERE  fecha     = '2026-12-01'
  AND  doctor_id = 17;

-- Verificación:
-- SELECT * FROM doctor_agenda WHERE fecha = '2026-12-01';


-- ============================================================
-- SECCIÓN 7: PACIENTES — Deduplicar por documento
--
-- Problema: no existe UNIQUE en `documento`. El mismo paciente
-- aparece múltiples veces (ej: Brayan Acosta: 6 registros).
--
-- Estrategia:
--   a) Para cada documento duplicado, conservar el MIN(id)
--   b) Redirigir citas_electro al ID canónico
--   c) Eliminar los duplicados
--   d) Agregar UNIQUE KEY para prevenir futuros duplicados
-- ============================================================

-- 7a. Redirigir citas_electro al paciente canónico (MIN id)
UPDATE citas_electro ce
INNER JOIN pacientes p
        ON ce.paciente_id = p.id
INNER JOIN (
    SELECT   documento,
             MIN(id) AS canonical_id
    FROM     pacientes
    WHERE    documento IS NOT NULL
      AND    documento <> ''
    GROUP BY documento
    HAVING   COUNT(*) > 1
) dup ON p.documento = dup.documento
     AND p.id        <> dup.canonical_id
SET ce.paciente_id = dup.canonical_id;

-- 7b. Eliminar pacientes duplicados (conserva el de menor id)
DELETE p
FROM   pacientes p
INNER JOIN (
    SELECT   documento,
             MIN(id) AS canonical_id
    FROM     pacientes
    WHERE    documento IS NOT NULL
      AND    documento <> ''
    GROUP BY documento
    HAVING   COUNT(*) > 1
) dup ON p.documento = dup.documento
     AND p.id        <> dup.canonical_id;

-- 7c. Agregar UNIQUE para prevenir futuros duplicados
ALTER TABLE pacientes
  ADD UNIQUE KEY `uk_documento` (`documento`);

-- Verificación:
-- SELECT COUNT(*) FROM pacientes;  -- debería ser ~140-160
-- SELECT documento, COUNT(*) c FROM pacientes GROUP BY documento HAVING c > 1;


-- ============================================================
-- SECCIÓN 8: RECIBOS — Agregar Foreign Keys faltantes
--
-- La tabla recibos referencia turnos, citas_electro y usuarios
-- pero sin FK constraints. Esto permite registros huérfanos.
--
-- Paso previo: anular referencias a registros eliminados
-- ============================================================

-- 8a. Anular turno_id que ya no existen en turnos
UPDATE recibos
SET    turno_id = NULL
WHERE  turno_id IS NOT NULL
  AND  turno_id NOT IN (SELECT id FROM turnos);

-- 8b. Anular cita_electro_id que ya no existen
UPDATE recibos
SET    cita_electro_id = NULL
WHERE  cita_electro_id IS NOT NULL
  AND  cita_electro_id NOT IN (SELECT id FROM citas_electro);

-- 8c. Anular medico_id que ya no existen en usuarios
UPDATE recibos
SET    medico_id = NULL
WHERE  medico_id IS NOT NULL
  AND  medico_id NOT IN (SELECT id FROM usuarios);

-- 8d. Anular generado_por_id que ya no existen
UPDATE recibos
SET    generado_por_id = NULL
WHERE  generado_por_id IS NOT NULL
  AND  generado_por_id NOT IN (SELECT id FROM usuarios);

-- 8e. Anular anulado_por_id que ya no existen
UPDATE recibos
SET    anulado_por_id = NULL
WHERE  anulado_por_id IS NOT NULL
  AND  anulado_por_id NOT IN (SELECT id FROM usuarios);

-- 8f. Anular pagado_por_id que ya no existen
UPDATE recibos
SET    pagado_por_id = NULL
WHERE  pagado_por_id IS NOT NULL
  AND  pagado_por_id NOT IN (SELECT id FROM usuarios);

-- 8g. Agregar las FK constraints
ALTER TABLE recibos
  ADD CONSTRAINT `fk_recibos_medico`
      FOREIGN KEY (`medico_id`)
      REFERENCES `usuarios` (`id`)
      ON DELETE SET NULL,

  ADD CONSTRAINT `fk_recibos_generado_por`
      FOREIGN KEY (`generado_por_id`)
      REFERENCES `usuarios` (`id`)
      ON DELETE SET NULL,

  ADD CONSTRAINT `fk_recibos_anulado_por`
      FOREIGN KEY (`anulado_por_id`)
      REFERENCES `usuarios` (`id`)
      ON DELETE SET NULL,

  ADD CONSTRAINT `fk_recibos_pagado_por`
      FOREIGN KEY (`pagado_por_id`)
      REFERENCES `usuarios` (`id`)
      ON DELETE SET NULL,

  ADD CONSTRAINT `fk_recibos_turno`
      FOREIGN KEY (`turno_id`)
      REFERENCES `turnos` (`id`)
      ON DELETE SET NULL,

  ADD CONSTRAINT `fk_recibos_cita_electro`
      FOREIGN KEY (`cita_electro_id`)
      REFERENCES `citas_electro` (`id`)
      ON DELETE SET NULL;

-- Verificación:
-- SHOW CREATE TABLE recibos\G


-- ============================================================
-- SECCIÓN 9: ÍNDICES DUPLICADOS — Eliminar redundancias
-- citas_electro tiene idx_fecha + idx_citas_electro_fecha (mismo campo)
-- recibos tiene idx_fecha + idx_recibos_fecha (mismo campo)
-- ============================================================

ALTER TABLE citas_electro
  DROP INDEX `idx_fecha`,
  DROP INDEX `idx_estado`,
  DROP INDEX `idx_equipo_fecha`;
-- Se conservan: idx_citas_electro_fecha, idx_citas_electro_estado,
--               idx_citas_electro_equipo, idx_citas_electro_fecha_estado

ALTER TABLE recibos
  DROP INDEX `idx_fecha`;
-- Se conserva: idx_recibos_fecha

ALTER TABLE pacientes
  DROP INDEX `idx_nombre`,
  DROP INDEX `idx_documento`;
-- Se conservan: idx_pacientes_nombre, idx_pacientes_documento, uk_documento

-- Verificación:
-- SHOW INDEX FROM citas_electro;
-- SHOW INDEX FROM recibos;
-- SHOW INDEX FROM pacientes;


-- ============================================================
-- RESTAURAR CONFIGURACIÓN
-- ============================================================

SET SQL_SAFE_UPDATES   = 1;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- RESUMEN DE CAMBIOS APLICADOS
-- ============================================================
-- [1] diagnosticos: Ñ restaurada en MIGRAÑA, SUEÑO, PEQUEÑO, etc.
-- [2] turnos: IDs 4,5,6,8,9,10 marcados como COMPLETADO
-- [3] citas_electro: 'Programado' sin equipo >14 días → Cancelado
-- [4] citas_electro: hora_fin_date corregido en estudios nocturnos
-- [5] dias_bloqueados: UNIQUE ahora por (fecha, doctor_id)
-- [6] doctor_agenda: entrada de prueba 2026-12-01 eliminada
-- [7] pacientes: duplicados eliminados, UNIQUE agregado en documento
-- [8] recibos: referencias huérfanas anuladas, 6 FK constraints agregadas
-- [9] índices duplicados eliminados (citas_electro, recibos, pacientes)
-- ============================================================

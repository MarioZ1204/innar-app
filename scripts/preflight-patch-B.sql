-- ============================================================
-- INNAR APP — Patch B PRE-FLIGHT (read-only)
-- ============================================================
-- Ejecutar ANTES de aplicar patch-B-db-integrity.sql.
-- Reporta el estado actual y posibles bloqueos. NO modifica datos.
-- ============================================================

-- [1] Diagnósticos con Ñ corrupta
SELECT 'diagnosticos_n_corrupta' AS check_name,
       COUNT(*) AS afectados
FROM   diagnosticos
WHERE  nombre LIKE '%—%';

-- [2] Turnos zombi (EN_SALA / EN_ATENCION) anteriores a hoy - 30 días
SELECT 'turnos_zombi' AS check_name,
       COUNT(*) AS afectados
FROM   turnos
WHERE  estado IN ('EN_SALA', 'EN_ATENCION')
  AND  fecha < DATE_SUB(CURDATE(), INTERVAL 30 DAY);

-- [3] Citas electro Programado sin equipo (>14 días)
SELECT 'citas_programadas_sin_equipo' AS check_name,
       COUNT(*) AS afectados
FROM   citas_electro
WHERE  estado     = 'Programado'
  AND  equipo_id IS NULL
  AND  fecha     < DATE_SUB(CURDATE(), INTERVAL 14 DAY)
  AND  deleted_at IS NULL;

-- [4] Citas electro con hora_fin_date incorrecto (cruce medianoche)
SELECT 'citas_hora_fin_date_incorrecto' AS check_name,
       COUNT(*) AS afectados
FROM   citas_electro
WHERE  hora_inicio  IS NOT NULL
  AND  hora_fin     IS NOT NULL
  AND  hora_fin      < hora_inicio
  AND  hora_fin_date = fecha
  AND  deleted_at   IS NULL;

-- [5] dias_bloqueados con UNIQUE incorrecto
SELECT 'dias_bloqueados_unique_actual' AS check_name,
       GROUP_CONCAT(Column_name) AS columnas_unique
FROM   information_schema.STATISTICS
WHERE  table_schema = DATABASE()
  AND  table_name   = 'dias_bloqueados'
  AND  non_unique   = 0
GROUP BY index_name;

-- [6] Pacientes duplicados por documento
SELECT 'pacientes_duplicados' AS check_name,
       COUNT(*) AS docs_duplicados,
       SUM(c - 1) AS pacientes_a_eliminar
FROM (
  SELECT documento, COUNT(*) AS c
  FROM   pacientes
  WHERE  documento IS NOT NULL
    AND  documento <> ''
  GROUP BY documento
  HAVING COUNT(*) > 1
) t;

-- [6.1] Referencias a pacientes duplicados en citas_electro
SELECT 'citas_a_redirigir' AS check_name,
       COUNT(*) AS afectados
FROM   citas_electro ce
JOIN   pacientes p ON p.id = ce.paciente_id
JOIN (
  SELECT documento, MIN(id) AS canonical_id
  FROM   pacientes
  WHERE  documento IS NOT NULL AND documento <> ''
  GROUP BY documento
  HAVING COUNT(*) > 1
) dup ON dup.documento = p.documento
WHERE ce.paciente_id <> dup.canonical_id;

-- [6.2] OTRAS tablas que apunten a pacientes (referencias implícitas)
-- Si aparecen filas aquí con tablas distintas a `citas_electro`, hay que
-- ampliar el patch antes del dedupe.
SELECT 'tablas_que_referencian_pacientes' AS check_name,
       TABLE_NAME, COLUMN_NAME
FROM   information_schema.KEY_COLUMN_USAGE
WHERE  table_schema      = DATABASE()
  AND  referenced_table_name = 'pacientes';

-- [7] Huérfanos en recibos antes de FK
SELECT 'recibos_huerfanos_turno' AS check_name, COUNT(*) AS afectados
FROM   recibos r
LEFT JOIN turnos t ON t.id = r.turno_id
WHERE  r.turno_id IS NOT NULL AND t.id IS NULL;

SELECT 'recibos_huerfanos_cita_electro' AS check_name, COUNT(*) AS afectados
FROM   recibos r
LEFT JOIN citas_electro c ON c.id = r.cita_electro_id
WHERE  r.cita_electro_id IS NOT NULL AND c.id IS NULL;

SELECT 'recibos_huerfanos_medico' AS check_name, COUNT(*) AS afectados
FROM   recibos r
LEFT JOIN usuarios u ON u.id = r.medico_id
WHERE  r.medico_id IS NOT NULL AND u.id IS NULL;

-- [8] Backup reciente
SELECT 'NOTA' AS info,
       'Asegúrate de tener un backup reciente (< 1 hora) antes de aplicar el patch' AS mensaje;

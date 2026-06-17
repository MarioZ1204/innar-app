const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'routes', 'electro.js');
let s = fs.readFileSync(f, 'utf8');
const old = `        if (!tieneEquipoAsignado) {
          const overlapCitas = await db.query(\`
            SELECT COUNT(*) as overlap_count FROM citas_electro
            WHERE id != ? AND estado IN ('Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado') AND deleted_at IS NULL
            AND TIMESTAMP(fecha, COALESCE(hora_agendamiento, '00:00:00')) < TIMESTAMP(?, ?)
            AND TIMESTAMP(COALESCE(hora_fin_date, fecha), COALESCE(hora_fin, '23:59:59')) > TIMESTAMP(?, ?)
          \`, [id, checkFechaFin, checkHoraFin, checkFecha, checkHora]);
          const overlapCount = overlapCitas[0]?.overlap_count || 0;
          const maxCuposRows = await db.query(\`SELECT COUNT(*) as total FROM equipos_electro WHERE activo = 1\`);
          const maxCupos = parseInt(maxCuposRows[0]?.total, 10) || 0;
          if (overlapCount >= maxCupos) {
            return res.status(409).json({ error: 'Sin capacidad disponible en este horario', details: \`Hay \${overlapCount} cupos ocupados. Máximo: \${maxCupos}\`, capacity: { active: overlapCount, max: maxCupos } });
          }
        }`;
const neu = `        if (!tieneEquipoAsignado) {
          const overlapRows = await db.query(\`
            SELECT fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date, duracion_minutos FROM citas_electro
            WHERE id != ? AND estado IN ('Programado', 'Confirmado', 'En Sala', 'En Estudio', 'Pausado') AND deleted_at IS NULL
            AND TIMESTAMP(fecha, COALESCE(hora_agendamiento, '00:00:00')) < TIMESTAMP(?, ?)
            AND TIMESTAMP(COALESCE(hora_fin_date, fecha), COALESCE(hora_fin, '23:59:59')) > TIMESTAMP(?, ?)
          \`, [id, checkFechaFin, checkHoraFin, checkFecha, checkHora]);
          const maxCuposRows = await db.query(\`SELECT COUNT(*) as total FROM equipos_electro WHERE activo = 1\`);
          const maxCupos = parseInt(maxCuposRows[0]?.total, 10) || 0;
          const [hhI, mmI] = checkHora.split(':').map((x) => parseInt(x, 10));
          const rangeStart = new Date(\`\${checkFecha}T\${String(hhI).padStart(2, '0')}:\${String(mmI).padStart(2, '0')}:00\`);
          const [hhF, mmF] = checkHoraFin.split(':').map((x) => parseInt(x, 10));
          const rangeEnd = new Date(\`\${checkFechaFin}T\${String(hhF).padStart(2, '0')}:\${String(mmF).padStart(2, '0')}:00\`);
          const cupoCheck = hayCupoElectroParaRango(overlapRows, rangeStart, rangeEnd, maxCupos);
          if (!cupoCheck.ok) {
            return res.status(409).json({
              error: 'Sin capacidad disponible en este horario',
              details: \`Pico simultáneo: \${cupoCheck.peak}/\${maxCupos}\`,
              capacity: { active: cupoCheck.peak, max: maxCupos }
            });
          }
        }`;
if (s.includes(old)) {
  s = s.replace(old, neu);
  fs.writeFileSync(f, s, 'utf8');
  console.log('PATCH peak ok');
} else {
  console.log('PATCH block not found or already patched');
}

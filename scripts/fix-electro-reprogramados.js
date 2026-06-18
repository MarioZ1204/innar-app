/**
 * Corrige citas electro reprogramadas con datos inconsistentes:
 * - estado "Reprogramado" → "Programado" (la marca queda en observaciones)
 * - observaciones sin [Reprogramado] cuando corresponde
 * - hora_fin / hora_fin_date desalineados con la fecha agendada
 *
 * Uso:
 *   node scripts/fix-electro-reprogramados.js           # aplica cambios
 *   node scripts/fix-electro-reprogramados.js --dry-run   # solo muestra qué haría
 */
require('dotenv').config({ path: '.env.dev' });
require('dotenv').config();

const db = require('../utils/db-mysql');
const {
  extraerFechaYmd,
  sumarMinutosAHoraYFecha,
  normalizarHoraHmElectro
} = require('../utils/electro-fechas');

function anexarNotaReprogramadoObs(obs) {
  const s = String(obs || '').trim();
  if (/\[Reprogramado\]/i.test(s)) return s || null;
  return s ? `[Reprogramado] ${s}` : '[Reprogramado]';
}

function calcularFinAgenda(cita) {
  const fechaBase = extraerFechaYmd(cita.fecha);
  const horaBase = normalizarHoraHmElectro(cita.hora_agendamiento)
    || normalizarHoraHmElectro(cita.hora_inicio);
  const durMin = parseInt(cita.duracion_minutos, 10);
  if (!fechaBase || !horaBase || !(durMin > 0)) return null;
  return sumarMinutosAHoraYFecha(fechaBase, horaBase, durMin);
}

function necesitaCorreccion(cita) {
  const motivos = [];
  const fechaYmd = extraerFechaYmd(cita.fecha);
  const finYmd = extraerFechaYmd(cita.hora_fin_date);
  const finCalc = calcularFinAgenda(cita);

  if (cita.estado === 'Reprogramado') motivos.push('estado=Reprogramado');
  if (/\[Reprogramado\]/i.test(String(cita.observaciones || '')) && cita.estado === 'Reprogramado') {
    motivos.push('estado duplicado con nota');
  }
  if (/\[Reprogramado\]/i.test(String(cita.observaciones || '')) && cita.estado !== 'Programado' && cita.estado !== 'Reprogramado') {
    motivos.push('nota reprogramado con estado distinto');
  }
  if (finYmd && fechaYmd && finYmd < fechaYmd) motivos.push('hora_fin_date anterior a fecha');
  if (finCalc) {
    const horaFinActual = normalizarHoraHmElectro(cita.hora_fin);
    if (horaFinActual !== finCalc.horaFin || finYmd !== finCalc.fechaFin) {
      motivos.push('hora_fin/hora_fin_date incoherentes');
    }
  }

  return motivos;
}

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  await db.initPool();

  const rows = await db.query(`
    SELECT id, fecha, hora_agendamiento, hora_inicio, hora_fin, hora_fin_date,
           duracion_minutos, estado, observaciones
    FROM citas_electro
    WHERE deleted_at IS NULL
      AND (
        estado = 'Reprogramado'
        OR observaciones LIKE '%[Reprogramado]%'
        OR (hora_fin_date IS NOT NULL AND hora_fin_date < fecha)
      )
    ORDER BY id ASC
  `);

  let corregidas = 0;
  let omitidas = 0;

  for (const cita of rows) {
    const motivos = necesitaCorreccion(cita);
    if (!motivos.length) {
      omitidas += 1;
      continue;
    }

    const finCalc = calcularFinAgenda(cita);
    const estadoNuevo = (cita.estado === 'Reprogramado' || /\[Reprogramado\]/i.test(String(cita.observaciones || '')))
      ? 'Programado'
      : cita.estado;
    const observacionesNueva = /\[Reprogramado\]/i.test(String(cita.observaciones || ''))
      ? String(cita.observaciones || '').trim() || null
      : (cita.estado === 'Reprogramado' ? anexarNotaReprogramadoObs(cita.observaciones) : cita.observaciones);

    const patch = {
      estado: estadoNuevo,
      observaciones: observacionesNueva,
      hora_fin: finCalc ? finCalc.horaFin : cita.hora_fin,
      hora_fin_date: finCalc ? finCalc.fechaFin : extraerFechaYmd(cita.fecha)
    };

    console.log(
      `[${dryRun ? 'DRY' : 'FIX'}] #${cita.id} ${extraerFechaYmd(cita.fecha)} ${cita.hora_agendamiento || ''} — ${motivos.join(', ')}`
    );
    console.log(
      `       estado: ${cita.estado} → ${patch.estado}; fin: ${cita.hora_fin_date || '-'} → ${patch.hora_fin_date}`
    );

    if (!dryRun) {
      await db.execute(
        `UPDATE citas_electro
         SET estado = ?, observaciones = ?, hora_fin = ?, hora_fin_date = ?, editado_en = NOW()
         WHERE id = ?`,
        [patch.estado, patch.observaciones, patch.hora_fin, patch.hora_fin_date, cita.id]
      );
    }
    corregidas += 1;
  }

  console.log(`\nListo. Corregidas: ${corregidas}, sin cambios: ${omitidas}, revisadas: ${rows.length}`);
  if (dryRun && corregidas > 0) {
    console.log('Ejecute sin --dry-run para aplicar los cambios.');
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

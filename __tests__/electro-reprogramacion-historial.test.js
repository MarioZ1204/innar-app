const {
  esMarcadaReprogramada,
  obtenerHistorialCompletoReprogramacionesElectro,
  backfillHistorialReprogramacionesElectro
} = require('../utils/electro-reprogramacion-historial');

describe('electro-reprogramacion-historial', () => {
  test('detecta marca [Reprogramado] en observaciones', () => {
    expect(esMarcadaReprogramada({ observaciones: '[Reprogramado] nota' })).toBe(true);
    expect(esMarcadaReprogramada({ estado: 'Reprogramado' })).toBe(true);
    expect(esMarcadaReprogramada({ observaciones: 'sin marca' })).toBe(false);
  });

  test('inferencia legacy empareja original marcada con cita nueva del mismo paciente', async () => {
    const db = {
      async query(sql, params) {
        const s = String(sql);
        if (s.includes('SHOW TABLES')) return [{ 'Tables_in_x': 'citas_electro_reprogramaciones' }];
        if (s.includes('FROM citas_electro_reprogramaciones')) return [];
        if (s.includes('reprogramada_desde_id FROM citas_electro')) return [{ reprogramada_desde_id: null }];
        if (s.includes('WHERE id = ? AND deleted_at IS NULL') && params[0] === 10) {
          return [{
            id: 10,
            paciente_id: 5,
            estudio: 'PSG Básica',
            estado: 'Programado',
            observaciones: '[Reprogramado]',
            fecha: '2026-08-01',
            hora_agendamiento: '20:00',
            reprogramado_en: null,
            reprogramado_por_nombre: null,
            reprogramada_desde_id: null,
            editado_por_nombre: 'Ana Recepción',
            editado_en: '2026-08-01 14:30:00',
            creado_en: '2026-07-28 10:00:00',
            programado_por_nombre: 'Ana Recepción'
          }];
        }
        if (s.includes('WHERE id = ? AND deleted_at IS NULL') && params[0] === 20) {
          return [{
            id: 20,
            paciente_id: 5,
            estudio: 'PSG Básica',
            estado: 'Programado',
            observaciones: null,
            fecha: '2026-08-05',
            hora_agendamiento: '21:00',
            reprogramado_en: null,
            reprogramado_por_nombre: null,
            reprogramada_desde_id: null,
            editado_por_nombre: 'Ana Recepción',
            editado_en: '2026-08-01 14:31:00',
            creado_en: '2026-08-01 14:31:00',
            programado_por_nombre: 'Ana Recepción'
          }];
        }
        if (s.includes('AND id > ?') && params[1] === 10) {
          return [{
            id: 20,
            paciente_id: 5,
            estudio: 'PSG Básica',
            fecha: '2026-08-05',
            hora_agendamiento: '21:00',
            creado_en: '2026-08-01 14:31:00',
            programado_por_nombre: 'Ana Recepción',
            reprogramada_desde_id: null
          }];
        }
        if (s.includes('observaciones LIKE') && params[0] === 5) return [];
        return [];
      }
    };

    const historial = await obtenerHistorialCompletoReprogramacionesElectro(db, 10);
    expect(historial.length).toBeGreaterThan(0);
    expect(historial[0].cita_original_id).toBe(10);
    expect(historial[0].cita_nueva_id).toBe(20);
    expect(historial[0].reprogramado_por_nombre).toBe('Ana Recepción');
    expect(historial[0].legacy).toBe(true);
  });

  test('backfill no inserta si ya existe historial para el original', async () => {
    let inserts = 0;
    const db = {
      async query(sql, params) {
        const s = String(sql);
        if (s.includes('SHOW TABLES')) return [{}];
        if (s.includes('observaciones LIKE') && s.includes('ORDER BY id ASC')) {
          return [{
            id: 1,
            paciente_id: 2,
            estudio: 'EEG',
            observaciones: '[Reprogramado]',
            estado: 'Programado',
            fecha: '2026-08-01',
            hora_agendamiento: '09:00',
            reprogramado_en: null,
            reprogramado_por_nombre: null,
            editado_por_nombre: 'Luis',
            editado_en: '2026-08-01 10:00:00',
            creado_en: '2026-08-01 09:00:00'
          }];
        }
        if (s.includes('cita_original_id = ?')) return [{ id: 99 }];
        return [];
      },
      async execute() {
        inserts += 1;
      }
    };
    const r = await backfillHistorialReprogramacionesElectro(db);
    expect(r.omitidos).toBe(1);
    expect(r.insertados).toBe(0);
    expect(inserts).toBe(0);
  });
});

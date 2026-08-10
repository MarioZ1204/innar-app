const {
  claveEntidad,
  totalesDesdeResumen,
  normalizarEntidadNombre,
  capacidadTotalSlotsDia,
  validarCupoEntidad
} = require('../utils/cupos-entidad-agenda');

/** DB falsa: responde según el SQL para simular un día con 1 jornada (mañana) de 25 min. */
function mockDb({
  especialidad = 'Neurología',
  disponible = 1,
  disponibleManana = 1,
  disponibleTarde = 0,
  agendaSlots = [],
  intervalosBloqueados = [],
  cuposEntidad = [],
  turnosOcupados = []
} = {}) {
  return {
    execute: async (sql) => {
      if (sql.includes('FROM usuarios')) return [{ especialidad }];
      if (sql.includes('FROM doctor_disponibilidad_mensual')) {
        return [{ disponible, disponible_manana: disponibleManana, disponible_tarde: disponibleTarde }];
      }
      if (sql.includes('FROM doctor_agenda')) return agendaSlots;
      if (sql.includes('FROM doctor_disponibilidad_intervalos')) return intervalosBloqueados;
      if (sql.includes('FROM doctor_cupos_entidad_dia')) return cuposEntidad;
      if (sql.includes('FROM turnos')) return turnosOcupados;
      return [];
    }
  };
}

describe('cupos-entidad-agenda helpers', () => {
  test('claveEntidad normaliza mayúsculas', () => {
    expect(claveEntidad('proinsalud')).toBe('PROINSALUD');
    expect(claveEntidad('  Sura  ')).toBe('SURA');
  });

  test('totalesDesdeResumen suma capacidad y libres', () => {
    const resumen = [
      { entidad: 'PROINSALUD', cupo_max: 10, ocupados: 7, libres: 3 },
      { entidad: 'SURA', cupo_max: 5, ocupados: 5, libres: 0 }
    ];
    const t = totalesDesdeResumen(resumen);
    expect(t.capacidad).toBe(15);
    expect(t.ocupados).toBe(12);
    expect(t.libres).toBe(3);
  });

  test('normalizarEntidadNombre recorta espacios', () => {
    expect(normalizarEntidadNombre('  UCQN ')).toBe('UCQN');
  });
});

describe('cupos-entidad-agenda — capacidad y reserva por entidad', () => {
  test('capacidadTotalSlotsDia: jornada de mañana (8-12) a 25 min = 10 cupos', async () => {
    const db = mockDb({ especialidad: 'Neurología' });
    const total = await capacidadTotalSlotsDia(1, '2026-08-20', db);
    expect(total).toBe(10); // 8:00,8:25,...,11:45
  });

  test('capacidadTotalSlotsDia: especialidad sin intervalo especial usa 40 min', async () => {
    const db = mockDb({ especialidad: 'Medicina general' });
    const total = await capacidadTotalSlotsDia(1, '2026-08-20', db);
    expect(total).toBe(6); // 8:00,8:40,9:20,10:00,10:40,11:20
  });

  test('validarCupoEntidad: entidad SIN cupo configurado exige confirmación al no quedar cupos generales', async () => {
    // 10 cupos totales, 10 reservados para PROINSALUD → 0 cupos generales.
    const db = mockDb({
      especialidad: 'Neurología',
      cuposEntidad: [{ entidad: 'PROINSALUD', cupo_max: 10 }],
      turnosOcupados: []
    });
    const res = await validarCupoEntidad(1, '2026-08-20', 'SURA', db, 1);
    expect(res.valido).toBe(false);
    expect(res.requiereConfirmacion).toBe(true);
  });

  test('validarCupoEntidad: con forzar=true se permite agendar en horario reservado de otra entidad', async () => {
    const db = mockDb({
      especialidad: 'Neurología',
      cuposEntidad: [{ entidad: 'PROINSALUD', cupo_max: 10 }],
      turnosOcupados: []
    });
    const res = await validarCupoEntidad(1, '2026-08-20', 'SURA', db, 1, { forzar: true });
    expect(res.valido).toBe(true);
  });

  test('validarCupoEntidad: al llenarse PROINSALUD, el cupo general restante sí se puede usar', async () => {
    // 10 cupos totales, 9 reservados para PROINSALUD → 1 cupo general libre.
    const db = mockDb({
      especialidad: 'Neurología',
      cuposEntidad: [{ entidad: 'PROINSALUD', cupo_max: 9 }],
      turnosOcupados: []
    });
    const res = await validarCupoEntidad(1, '2026-08-20', 'SURA', db, 1);
    expect(res.valido).toBe(true);
  });

  test('validarCupoEntidad: el segundo paciente de otra entidad ya no cabe en el único cupo general', async () => {
    const db = mockDb({
      especialidad: 'Neurología',
      cuposEntidad: [{ entidad: 'PROINSALUD', cupo_max: 9 }],
      turnosOcupados: [{ entidad: 'SURA', cnt: 1 }]
    });
    const res = await validarCupoEntidad(1, '2026-08-20', 'SURA', db, 1);
    expect(res.valido).toBe(false);
  });

  test('validarCupoEntidad: PROINSALUD sigue validando su propio cupo reservado normalmente', async () => {
    const db = mockDb({
      especialidad: 'Neurología',
      cuposEntidad: [{ entidad: 'PROINSALUD', cupo_max: 10 }],
      turnosOcupados: [{ entidad: 'PROINSALUD', cnt: 10 }]
    });
    const res = await validarCupoEntidad(1, '2026-08-20', 'PROINSALUD', db, 1);
    expect(res.valido).toBe(false);
  });
});

const {
  turnoEsCitaDuplicadaTipo,
  filtrarCitasMismoTipo
} = require('../utils/turnos-duplicados-consulta');

const base = {
  id: 1,
  paciente_documento: '1234567890',
  paciente_nombre: 'JUAN PEREZ',
  paciente_telefono: '3001234567',
  tipo_consulta: 'Control por Neurología',
  estado: 'PENDIENTE',
  fecha: '2026-08-20',
  hora: '08:00'
};

describe('turnos-duplicados-consulta', () => {
  const filtro = {
    paciente_documento: '1234567890',
    paciente_nombre: 'Juan Pérez',
    paciente_telefono: '3001234567',
    tipo_consulta: 'control por neurologia'
  };

  test('detecta misma persona y mismo tipo de consulta', () => {
    expect(turnoEsCitaDuplicadaTipo(base, filtro)).toBe(true);
  });

  test('no alerta si el tipo de consulta es distinto', () => {
    expect(turnoEsCitaDuplicadaTipo({ ...base, tipo_consulta: 'Primera vez' }, filtro)).toBe(false);
  });

  test('no alerta citas canceladas o atendidas', () => {
    expect(turnoEsCitaDuplicadaTipo({ ...base, estado: 'CANCELADO' }, filtro)).toBe(false);
    expect(turnoEsCitaDuplicadaTipo({ ...base, estado: 'ATENDIDO' }, filtro)).toBe(false);
    expect(turnoEsCitaDuplicadaTipo({ ...base, estado: 'REPROGRAMADO' }, filtro)).toBe(false);
  });

  test('no alerta si el documento es distinto', () => {
    expect(turnoEsCitaDuplicadaTipo({ ...base, paciente_documento: '999' }, filtro)).toBe(false);
  });

  test('alerta aunque el nombre esté escrito distinto si el documento y el tipo coinciden', () => {
    expect(turnoEsCitaDuplicadaTipo({ ...base, paciente_nombre: 'JUAN C. PEREZ' }, filtro)).toBe(true);
  });

  test('filtra la lista dejando solo duplicados vigentes', () => {
    const rows = [
      base,
      { ...base, id: 2, fecha: '2026-08-21', estado: 'EN_SALA' },
      { ...base, id: 3, estado: 'CANCELADO' },
      { ...base, id: 4, tipo_consulta: 'Otra' }
    ];
    expect(filtrarCitasMismoTipo(rows, filtro).map((t) => t.id)).toEqual([1, 2]);
  });
});

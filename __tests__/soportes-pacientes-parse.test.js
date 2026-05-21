const {
  parseLineaPaciente,
  parseListaPacientes,
  codigoCarpetaPaciente
} = require('../utils/soportes-pacientes-parse');

describe('soportes-pacientes-parse', () => {
  test('parsea Nombre Apellido', () => {
    const p = parseLineaPaciente('Juan Pérez');
    expect(p.paciente_nombre).toBe('Juan Pérez');
    expect(p.codigo).toBe(codigoCarpetaPaciente('Juan', 'Pérez'));
  });

  test('parsea Apellido, Nombre', () => {
    const p = parseLineaPaciente('García, María');
    expect(p.apellido).toBe('García');
    expect(p.nombre).toBe('María');
  });

  test('lista con duplicados genera sufijo', () => {
    const list = parseListaPacientes('Ana López\nAna López');
    expect(list).toHaveLength(2);
    expect(list[0].codigo).not.toBe(list[1].codigo);
  });
});

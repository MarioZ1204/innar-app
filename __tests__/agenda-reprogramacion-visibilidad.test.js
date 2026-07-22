const { sqlFantasmaReprogramadoReciente, DIAS_FANTASMA_REPROGRAMADO } = require('../utils/agenda-reprogramacion-visibilidad');

describe('agenda reprogramacion visibilidad', () => {
  test('oculta reprogramados después del plazo de fantasma', () => {
    const sql = sqlFantasmaReprogramadoReciente('t');
    expect(sql).toContain(`< ${DIAS_FANTASMA_REPROGRAMADOS}`);
    expect(sql).toContain("t.estado <> 'REPROGRAMADO'");
    expect(sql).toContain('t.reprogramado_en');
  });
});

const { sqlFantasmaReprogramadoReciente, DIAS_FANTASMA_REPROGRAMADO } = require('../utils/agenda-reprogramacion-visibilidad');

describe('agenda reprogramacion visibilidad', () => {
  test('el helper de fantasma sigue documentando el plazo histórico', () => {
    const sql = sqlFantasmaReprogramadoReciente('t');
    expect(sql).toContain(`< ${DIAS_FANTASMA_REPROGRAMADO}`);
    expect(sql).toContain("t.estado <> 'REPROGRAMADO'");
    expect(sql).toContain('t.reprogramado_en');
  });
});

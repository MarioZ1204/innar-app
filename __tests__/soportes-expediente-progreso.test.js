const { computeExpedienteListaProgreso } = require('../utils/soportes-expediente-progreso');

describe('computeExpedienteListaProgreso', () => {
  test('soportes electro: 4/4 cuando OPF CRC FEV PDX', () => {
    const exp = { tipo_servicio: 'electro', fev_externa_verificada: 0 };
    const arch = [
      { tipo: 'OPF' },
      { tipo: 'CRC' },
      { tipo: 'FEV' },
      { tipo: 'PDX' }
    ];
    const p = computeExpedienteListaProgreso(exp, arch, 'soportes');
    expect(p.progreso_done).toBe(4);
    expect(p.progreso_total).toBe(4);
    expect(p.documentos_completos).toBe(true);
  });

  test('FEV externa cuenta sin archivo FEV', () => {
    const exp = { tipo_servicio: 'electro', fev_externa_verificada: 1 };
    const arch = [{ tipo: 'OPF' }, { tipo: 'CRC' }, { tipo: 'PDX' }];
    const p = computeExpedienteListaProgreso(exp, arch, 'soportes');
    expect(p.progreso_done).toBe(4);
    expect(p.documentos_completos).toBe(true);
  });

  test('consulta usa HEV en lugar de PDX', () => {
    const exp = { tipo_servicio: 'consulta', fev_externa_verificada: 0 };
    const arch = [{ tipo: 'OPF' }, { tipo: 'CRC' }, { tipo: 'FEV' }, { tipo: 'HEV' }];
    const p = computeExpedienteListaProgreso(exp, arch, 'soportes');
    expect(p.documentos_completos).toBe(true);
    expect(p.progreso_items.map((i) => i.key)).toEqual(['OPF', 'CRC', 'FEV', 'HEV']);
  });

  test('incompleto: 2/4', () => {
    const exp = { tipo_servicio: 'electro', fev_externa_verificada: 0 };
    const p = computeExpedienteListaProgreso(exp, [{ tipo: 'OPF' }, { tipo: 'CRC' }], 'soportes');
    expect(p.progreso_done).toBe(2);
    expect(p.documentos_completos).toBe(false);
  });

  test('rips: 3 archivos', () => {
    const arch = [
      { slot: 'json_1' },
      { slot: 'json_2' },
      { slot: 'xml' }
    ];
    const p = computeExpedienteListaProgreso({}, arch, 'rips');
    expect(p.documentos_completos).toBe(true);
    expect(p.progreso_done).toBe(3);
  });
});

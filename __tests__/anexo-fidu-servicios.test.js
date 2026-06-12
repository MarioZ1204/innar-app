const {
  aplicarCatalogoServicio,
  enriquecerRegistroAnexoFidu,
  buscarServicioPorCodigo,
  normalizarCiudadResidencia,
  calcularValorTotalFact,
  aplicarValorTotalCalculado,
  ANEXO_FIDU_CATALOGO_SERVICIOS
} = require('../utils/anexo-fidu-servicios');

describe('anexo-fidu-servicios', () => {
  test('catálogo tiene 50 servicios', () => {
    expect(ANEXO_FIDU_CATALOGO_SERVICIOS.length).toBe(50);
  });

  test('aplica consulta fisioterapia primera vez (890211)', () => {
    const { ok, row } = aplicarCatalogoServicio('890211', {});
    expect(ok).toBe(true);
    expect(row.codigo_servicio).toBe('890211');
    expect(row.nombre_servicio).toContain('FISIOTERAPIA');
    expect(row.valor_unitario).toBe('$ 35.119');
    expect(row.valor_total_fact).toBe('$ 35.119');
    expect(row.codigo_servicio_referencia).toBe('327');
  });

  test('aplica PSG básica (891704) con valores y RIPS', () => {
    const { ok, row } = aplicarCatalogoServicio('891704', {});
    expect(ok).toBe(true);
    expect(row.codigo_servicio).toBe('891704');
    expect(row.nombre_servicio).toContain('POLISOMNOGRAFIA');
    expect(row.nit).toBe('901164565-1');
    expect(row.prefijo_fact).toBe('FE');
    expect(row.ciudad).toBe('Pasto');
    expect(row.plan).toBe('25');
    expect(row.valor_unitario).toBe('$ 1.564.355');
    expect(row.valor_total_fact).toBe('$ 1.564.355');
    expect(row.condicion_destino_persona).toBe('05');
    expect(row.codigo_servicio_referencia).toBe('327');
  });

  test('valor total = valor unitario × cantidad', () => {
    expect(calcularValorTotalFact('$ 150.000', '2')).toBe('$ 300.000');
    expect(calcularValorTotalFact('$ 23.748', '')).toBe('$ 0');
    const row = aplicarValorTotalCalculado({ valor_unitario: '$ 53.365', cantidad: '3' });
    expect(row.valor_total_fact).toBe('$ 160.095');
  });

  test('preserva cantidad importada del Excel al aplicar catálogo', () => {
    const { ok, row } = aplicarCatalogoServicio('891704', { cantidad: '3' });
    expect(ok).toBe(true);
    expect(row.cantidad).toBe('3');
    expect(row.valor_total_fact).toBe('$ 4.693.065');
  });

  test('terapia física deja cantidad vacía y total en cero', () => {
    const { ok, row } = aplicarCatalogoServicio('931001', {});
    expect(ok).toBe(true);
    expect(row.cantidad).toBe('');
    expect(row.valor_total_fact).toBe('$ 0');
    expect(row.codigo_servicio_referencia).toBe('739');
  });

  test('enriquecer normaliza ciudad residencia corta', () => {
    const row = enriquecerRegistroAnexoFidu({
      codigo_servicio: '890208',
      ciudad_residencia: 'Pasto'
    });
    expect(row.ciudad_residencia).toBe('San Juan de Pasto');
    expect(row.nombre_servicio).toContain('PSICOLOGIA');
  });

  test('busca código con ceros a la izquierda', () => {
    expect(buscarServicioPorCodigo('53105')?.codigo).toBe('053105');
    expect(buscarServicioPorCodigo('053105')?.nombre).toContain('BLOQUEO');
    expect(normalizarCiudadResidencia('Pasto')).toBe('San Juan de Pasto');
    expect(normalizarCiudadResidencia('San Juan de Pasto')).toBe('San Juan de Pasto');
  });
});

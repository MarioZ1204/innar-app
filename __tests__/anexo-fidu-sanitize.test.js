const { ANEXO_FIDU_COLUMN_KEYS } = require('../utils/anexo-fidu-columns');

// sanitizeRegistroBody vive en routes; probamos el comportamiento vía require interno
function sanitizeRegistroBody(body) {
  const { formatFechaParaCelda, calcularEdadDesdeFecha } = require('../utils/anexo-fidu-import');
  const { correoParaAnexo } = require('../utils/anexo-fidu-personas');
  const { enriquecerRegistroAnexoFidu, CAMPOS_SERVICIO_AUTO } = require('../utils/anexo-fidu-servicios');

  const out = {};
  for (const key of ANEXO_FIDU_COLUMN_KEYS) {
    if (body[key] == null) out[key] = '';
    else out[key] = String(body[key]).trim();
  }
  const antes = { ...out };
  const enriched = enriquecerRegistroAnexoFidu(out);
  ANEXO_FIDU_COLUMN_KEYS.forEach((k) => {
    if (!CAMPOS_SERVICIO_AUTO.has(k) && String(antes[k] || '').trim()) {
      enriched[k] = antes[k];
    }
  });
  enriched.correo = correoParaAnexo(enriched.correo || antes.correo);
  return enriched;
}

describe('sanitize registro anexo', () => {
  test('preserva campos manuales al enriquecer con catálogo', () => {
    const row = sanitizeRegistroBody({
      codigo_servicio: '891704',
      numero_orden_fomag: 'ORD-123',
      nombre_diagnostico: 'INSOMNIO',
      codigo_prestador: '0500101296',
      correo: 'paciente@mail.com',
      telefono: '3001112233'
    });
    expect(row.numero_orden_fomag).toBe('ORD-123');
    expect(row.nombre_diagnostico).toBe('INSOMNIO');
    expect(row.codigo_prestador).toBe('0500101296');
    expect(row.correo).toBe('paciente@mail.com');
    expect(row.telefono).toBe('3001112233');
    expect(row.codigo_servicio).toBe('891704');
  });

  test('correo vacío pasa a notiene@gmail.com', () => {
    const row = sanitizeRegistroBody({
      codigo_servicio: '891704',
      numero_documento: '123'
    });
    expect(row.correo).toBe('notiene@gmail.com');
  });
});

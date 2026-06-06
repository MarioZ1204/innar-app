const {
  mensajeDuplicadoPdx,
  esDuplicadoConsultaMedica,
  buscarDuplicadoPdxEnCarpeta
} = require('../utils/soportes-pdx-duplicados');

describe('soportes-pdx-duplicados', () => {
  test('mensaje duplicado incluye paciente', () => {
    const msg = mensajeDuplicadoPdx({
      row: { id: 12, paciente_nombre: 'GARCIA, Ana' }
    });
    expect(msg).toContain('GARCIA, Ana');
    expect(msg).toContain('duplicados');
  });

  test('consultas médicas: mismo paciente con distinta fecha no es duplicado', () => {
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-03-10',
      estudio_texto: 'Neurología'
    };
    const existente = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-03-15',
      estudio_texto: 'Neurología'
    };
    expect(esDuplicadoConsultaMedica(meta, existente)).toBe(false);
  });

  test('consultas médicas: mismo paciente con distinta especialidad no es duplicado', () => {
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-03-10',
      estudio_texto: 'Epileptología'
    };
    const existente = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-03-10',
      estudio_texto: 'Neurología'
    };
    expect(esDuplicadoConsultaMedica(meta, existente)).toBe(false);
  });

  test('consultas médicas: no bloquea solo por nombre visible del archivo', async () => {
    const db = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('nombre_archivo_display =')) {
          throw new Error('consulta por nombre visible no esperada');
        }
        return [];
      })
    };
    const carpeta = { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' };
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-04-01',
      estudio_texto: 'Neurología',
      nombre_archivo_display: 'COMPROBANTE Ana Garcia 2026-04-01 Neurología.pdf'
    };
    const dup = await buscarDuplicadoPdxEnCarpeta(db, 3, meta, carpeta);
    expect(dup).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(String(db.query.mock.calls[0][0])).not.toContain('nombre_archivo_display =');
  });
});

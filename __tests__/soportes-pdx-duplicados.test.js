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

  test('comprobantes: detecta duplicado por documento+fecha aunque especialidad sea diferente', async () => {
    const db = {
      query: jest.fn(async (sql, params) => {
        // Simular BD: hay un archivo con el mismo documento y fecha pero especialidad distinta
        if (String(sql).includes('paciente_documento = ?') && String(sql).includes('fecha_estudio = ?')) {
          // Busca por documento+fecha (el nuevo comportamiento)
          const [carpetaId, doc, fecha] = params;
          return [{
            id: 99,
            paciente_documento: doc,
            fecha_estudio: fecha,
            estudio_texto: 'Neurología', // Especialidad antigua
            paciente_nombre: 'Garcia, Ana'
          }];
        }
        return [];
      })
    };
    const carpeta = { nombre_display: 'COMPROBANTES' };
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      paciente_documento: '1234567890',
      fecha_estudio: '2026-04-01',
      estudio_texto: 'Psiquiatría', // Nueva especialidad (diferente a la anterior)
      nombre_archivo_display: 'COMPROBANTE Ana Garcia CC 1234567890 2026-04-01 Psiquiatría.pdf'
    };
    
    // Debe detectar como duplicado porque coinciden documento y fecha
    const dup = await buscarDuplicadoPdxEnCarpeta(db, 1, meta, carpeta);
    expect(dup).not.toBeNull();
    expect(dup.row.id).toBe(99);
    expect(dup.motivo).toBe('documento_fecha');
  });

  test('comprobantes: búsqueda por documento+fecha ignora estudio_texto', async () => {
    const db = {
      query: jest.fn(async () => [])
    };
    const carpeta = { nombre_display: 'COMPROBANTES' };
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      paciente_documento: '1234567890',
      fecha_estudio: '2026-04-01',
      estudio_texto: 'Neurología'
    };
    
    await buscarDuplicadoPdxEnCarpeta(db, 1, meta, carpeta);
    
    // Verificar que la SQL NO incluye estudio_texto en el WHERE (puede estar en SELECT)
    const sqlCall = String(db.query.mock.calls[0][0]);
    expect(sqlCall).toContain('paciente_documento = ?');
    expect(sqlCall).toContain('fecha_estudio = ?');
    // Verificar que estudio_texto NO está en la condición WHERE
    const whereMatch = sqlCall.match(/WHERE.*?(?=LIMIT|$)/);
    expect(whereMatch[0]).not.toContain('estudio_texto');
  });

  test('consultas médicas comprobantes: mismo paciente y fecha con distinto tipo de consulta no es duplicado', async () => {
    const db = {
      query: jest.fn(async (sql, params) => {
        if (String(sql).includes('comprobante_consulta') || (String(sql).includes('paciente_nombre_norm = ?') && String(sql).includes('marca_tiempo'))) {
          return [];
        }
        return [];
      })
    };
    const carpeta = { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' };
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-04-01',
      estudio_texto: 'Neurología',
      marca_tiempo: 'Control',
      tipo_consulta: 'Control'
    };
    const dup = await buscarDuplicadoPdxEnCarpeta(db, 3, meta, carpeta);
    expect(dup).toBeNull();
  });

  test('consultas médicas comprobantes: detecta duplicado con mismo tipo de consulta', async () => {
    const db = {
      query: jest.fn(async (sql, params) => {
        if (String(sql).includes('paciente_nombre_norm = ?') && String(sql).includes('marca_tiempo')) {
          return [{ id: 55, paciente_nombre: 'Garcia, Ana', marca_tiempo: 'Control' }];
        }
        return [];
      })
    };
    const carpeta = { nombre_display: 'COMPROBANTES CONSULTAS MÉDICAS' };
    const meta = {
      paciente_nombre_norm: 'garcia ana',
      fecha_estudio: '2026-04-01',
      estudio_texto: 'Neurología',
      marca_tiempo: 'Control',
      tipo_consulta: 'Control'
    };
    const dup = await buscarDuplicadoPdxEnCarpeta(db, 3, meta, carpeta);
    expect(dup).not.toBeNull();
    expect(dup.motivo).toBe('comprobante_consulta');
  });
});

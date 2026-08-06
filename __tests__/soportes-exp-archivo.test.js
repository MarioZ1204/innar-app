jest.mock('../utils/db-mysql', () => ({
  query: jest.fn(),
  execute: jest.fn()
}));

const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../utils/db-mysql');
const {
  normalizarTipoArchivo,
  SOPORTES_SLOT_TIPOS,
  resolveArchivoAbsoluto,
  repararArchivoExpedienteRow,
  repararArchivosExpediente,
  resolverArchivoExpedienteSlot,
  resolverArchivoExpedienteRow,
  buscarRutaHistoricaArchivo,
  obtenerExpedienteContext
} = require('../utils/soportes-exp-archivo');

describe('soportes-exp-archivo', () => {
  let tempRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soportes-exp-archivo-'));
    process.env.UPLOADS_DIR = tempRoot;
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    delete process.env.UPLOADS_DIR;
  });

  test('normaliza tipos SOPORTES y RIPS', () => {
    expect(normalizarTipoArchivo('crc').tipo).toBe('CRC');
    expect(normalizarTipoArchivo('RIPS_XML').slotDb).toBe('xml');
    expect(normalizarTipoArchivo('FOO')).toBeNull();
  });

  test('lista slots soportes', () => {
    expect(SOPORTES_SLOT_TIPOS).toContain('OPF');
    expect(SOPORTES_SLOT_TIPOS).toContain('CRC');
  });

  test('encuentra el archivo por tipo y prefijo cuando la ruta guardada cambió de nombre', () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15925');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const resolved = resolveArchivoAbsoluto({
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15925/OPF_901164565_FE15925.pdf',
      nombre_archivo: 'OPF_901164565_FE15925.pdf',
      tipo: 'OPF'
    });

    expect(resolved).toBe(filePath);
  });

  test('repara la ruta y nombre del archivo cuando el registro quedó desfasado', async () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15925');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'CRC_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(filePath, 'pdf');

    db.execute.mockResolvedValue({ affectedRows: 1 });

    const result = await repararArchivoExpedienteRow({
      id: 42,
      expediente_id: 1,
      tipo: 'CRC',
      nombre_archivo: 'CRC_901164565_FE15925.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15925/CRC_901164565_FE15925.pdf'
    });

    expect(result.repaired).toBe(true);
    expect(db.execute).toHaveBeenCalled();
  });

  test('reconoce el archivo correcto cuando el expediente usa un FE distinto al registro anterior', async () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE16300');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_FE16300.pdf');
    fs.writeFileSync(filePath, 'pdf');

    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'FE16300', numero_factura: 16300 }]);
    db.execute.mockResolvedValue({ affectedRows: 1 });

    const result = await repararArchivoExpedienteRow({
      id: 43,
      expediente_id: 1,
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15448.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
    });

    expect(result.repaired).toBe(true);
    expect(result.nombre_archivo).toBe('OPF_901164565_FE16300.pdf');
    expect(result.ruta_relativa).toContain('/FE16300/OPF_901164565_FE16300.pdf');
  });

  test('recupera el archivo cuando el nombre del PDF usa el nombre de la carpeta del expediente', () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'PEREZ_JUAN');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const resolved = resolveArchivoAbsoluto({
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15448.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
    }, {
      expediente: { codigo: 'FE15448', numero_factura: 15448, nombre_display: 'PEREZ_JUAN' }
    });

    expect(resolved).toBe(filePath);
  });

  test('carga el contexto del expediente sin depender de contenedor_tipo si la columna no existe', async () => {
    db.query.mockResolvedValueOnce([{ id: 1, codigo: 'FE15448', numero_factura: 15448, periodo: '2026-03', nombre_display: 'PEREZ JUAN', estado_facturacion: 'a_facturar' }]);

    const context = await require('../utils/soportes-exp-archivo').repararArchivoExpedienteRow({
      id: 99,
      expediente_id: 1,
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15448.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
    });

    expect(context.ok).toBe(false);
    const querySql = db.query.mock.calls[0][0];
    expect(querySql).toContain('FROM sop_expedientes');
    expect(querySql).not.toContain('contenedor_tipo');
  });

  test('obtiene el contexto del expediente sin depender de columnas opcionales como periodo', async () => {
    db.query.mockResolvedValueOnce([
      { Field: 'id' },
      { Field: 'codigo' },
      { Field: 'numero_factura' },
      { Field: 'paciente_nombre' },
      { Field: 'paciente_documento' },
      { Field: 'tipo_servicio' },
      { Field: 'dia_id' },
      { Field: 'contenedor_id' },
      { Field: 'fev_externa_verificada' },
      { Field: 'listo_radicacion' },
      { Field: 'notas' },
      { Field: 'creado_por' },
      { Field: 'creado_en' }
    ]);
    db.query.mockResolvedValueOnce([{ id: 5, codigo: 'FE15925', numero_factura: 15925, paciente_nombre: 'Juan' }]);

    const context = await obtenerExpedienteContext(5);

    expect(context).toMatchObject({ id: 5, codigo: 'FE15925', numero_factura: 15925 });
    expect(context.periodo).toBeUndefined();
  });

  test('repara expedientes legacy que comparten el mismo archivo físico entre dos soportes', async () => {
    const expId = 77;
    const targetDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE14726');
    fs.mkdirSync(targetDir, { recursive: true });
    const sharedFile = path.join(targetDir, 'OPF_901164565_FE14726.pdf');
    fs.writeFileSync(sharedFile, 'shared');

    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM sop_exp_archivos WHERE expediente_id = ?')) {
        return [
          { id: 1, expediente_id: expId, tipo: 'OPF', nombre_archivo: 'OPF_901164565_FE14726.pdf', ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE14726/OPF_901164565_FE14726.pdf' },
          { id: 2, expediente_id: expId, tipo: 'CRC', nombre_archivo: 'CRC_901164565_FE14726.pdf', ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE14726/CRC_901164565_FE14726.pdf' }
        ];
      }
      if (sql.includes('SHOW COLUMNS FROM sop_expedientes')) {
        return [{ Field: 'id' }, { Field: 'codigo' }, { Field: 'numero_factura' }];
      }
      if (sql.includes('FROM sop_expedientes e')) {
        return [{ id: expId, codigo: 'FE14726', numero_factura: 14726, dia_id: 5, contenedor_tipo: 'soportes', periodo: '2026-03', nombre_display: 'Día 1', estado_facturacion: 'a_facturar' }];
      }
      return [];
    });
    db.execute.mockResolvedValue({ affectedRows: 1 });

    const results = await repararArchivosExpediente(expId);
    expect(results.some((item) => item?.error === 'archivo_duplicado' || (item?.ok === false && item?.repaired === false))).toBe(true);
  });

  test('encuentra OPF con nombre de paciente en carpeta del expediente facturado', () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE16300');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(filePath, 'pdf-paciente');

    const resolved = resolveArchivoAbsoluto({
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15448.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
    }, {
      expediente: { codigo: 'FE16300', numero_factura: 16300, paciente_nombre: 'Juan Pérez' }
    });

    expect(resolved).toBe(filePath);
  });

  test('recupera la ruta histórica cuando el archivo actual ya no está en la ruta de FE', () => {
    const legacyDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'PEREZ_JUAN');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, 'OPF_901164565_PEREZ_JUAN.pdf');
    fs.writeFileSync(legacyFile, 'legacy');

    const recovered = buscarRutaHistoricaArchivo({
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE14726.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE14726/OPF_901164565_FE14726.pdf'
    }, tempRoot);

    expect(recovered).toBe(legacyFile);
  });

  test('recupera el archivo incluso cuando la ruta relativa está vacía', () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15925');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_FE15925.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const resolved = resolveArchivoAbsoluto({
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15925.pdf',
      ruta_relativa: ''
    }, {
      expediente: { codigo: 'FE15925', numero_factura: 15925, nombre_display: 'PEREZ_JUAN' }
    });

    expect(resolved).toBe(filePath);
  });

  test('no enlaza un OPF de otra factura FE cuando el expediente es FE16300', () => {
    const wrongDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15448');
    const rightDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE16300');
    fs.mkdirSync(wrongDir, { recursive: true });
    fs.mkdirSync(rightDir, { recursive: true });
    fs.writeFileSync(path.join(wrongDir, 'OPF_901164565_FE15448.pdf'), 'wrong');
    const rightFile = path.join(rightDir, 'OPF_901164565_FE16300.pdf');
    fs.writeFileSync(rightFile, 'right');

    const resolved = resolveArchivoAbsoluto({
      tipo: 'OPF',
      nombre_archivo: 'OPF_901164565_FE15448.pdf',
      ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
    }, {
      expediente: { codigo: 'FE16300', numero_factura: 16300, nombre_display: 'PEREZ_JUAN' }
    });

    expect(resolved).toBe(rightFile);
  });

  test('repararArchivosExpediente usa el contexto actualizado sin leer BD stale', async () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE16300');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_FE16300.pdf');
    fs.writeFileSync(filePath, 'pdf');

    db.query.mockResolvedValueOnce([
      {
        id: 1,
        expediente_id: 9,
        tipo: 'OPF',
        nombre_archivo: 'OPF_901164565_PEREZ_JUAN.pdf',
        ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/PEREZ_JUAN/OPF_901164565_PEREZ_JUAN.pdf'
      }
    ]);
    db.execute.mockResolvedValue({ affectedRows: 1 });

    const results = await repararArchivosExpediente(9, { id: 9, codigo: 'FE16300', numero_factura: 16300 });

    expect(results[0].repaired).toBe(true);
    expect(results[0].nombre_archivo).toBe('OPF_901164565_FE16300.pdf');
    const expedienteQueries = db.query.mock.calls.filter((args) => String(args[0]).includes('FROM sop_expedientes'));
    expect(expedienteQueries).toHaveLength(0);
  });

  test('resolverArchivoExpedienteSlot repara cuando la ruta guardada apunta a otra factura FE', async () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE16300');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'OPF_901164565_FE16300.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const wrongDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE15448');
    fs.mkdirSync(wrongDir, { recursive: true });
    fs.writeFileSync(path.join(wrongDir, 'OPF_901164565_FE15448.pdf'), 'wrong');

    db.query.mockImplementation((sql) => {
      if (sql.includes('FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?')) {
        return [{
          id: 55,
          expediente_id: 12,
          tipo: 'OPF',
          nombre_archivo: 'OPF_901164565_FE15448.pdf',
          ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
        }];
      }
      if (sql.includes('FROM sop_exp_archivos WHERE expediente_id = ?') && !sql.includes('AND tipo')) {
        return [{
          id: 55,
          expediente_id: 12,
          tipo: 'OPF',
          nombre_archivo: 'OPF_901164565_FE15448.pdf',
          ruta_relativa: 'soportes/armado/2026/03/A_FACTURAR/SOPORTES/FE15448/OPF_901164565_FE15448.pdf'
        }];
      }
      if (sql.includes('SHOW COLUMNS FROM sop_expedientes')) {
        return [{ Field: 'id' }, { Field: 'codigo' }, { Field: 'numero_factura' }];
      }
      if (sql.includes('FROM sop_expedientes e')) {
        return [{ id: 12, codigo: 'FE16300', numero_factura: 16300 }];
      }
      return [];
    });
    db.execute.mockImplementation(async (sql, params) => {
      if (String(sql).includes('UPDATE sop_exp_archivos')) {
        db.query.mockImplementation((innerSql) => {
          if (innerSql.includes('FROM sop_exp_archivos WHERE expediente_id = ? AND tipo = ?')) {
            return [{
              id: 55,
              expediente_id: 12,
              tipo: 'OPF',
              nombre_archivo: params[0],
              ruta_relativa: params[1]
            }];
          }
          if (innerSql.includes('FROM sop_exp_archivos WHERE expediente_id = ?') && !innerSql.includes('AND tipo')) {
            return [{
              id: 55,
              expediente_id: 12,
              tipo: 'OPF',
              nombre_archivo: params[0],
              ruta_relativa: params[1]
            }];
          }
          if (innerSql.includes('SHOW COLUMNS FROM sop_expedientes')) {
            return [{ Field: 'id' }, { Field: 'codigo' }, { Field: 'numero_factura' }];
          }
          if (innerSql.includes('FROM sop_expedientes e')) {
            return [{ id: 12, codigo: 'FE16300', numero_factura: 16300 }];
          }
          return [];
        });
      }
      return { affectedRows: 1 };
    });

    const resolved = await resolverArchivoExpedienteSlot(12, 'OPF');

    expect(resolved.ok).toBe(true);
    expect(resolved.fp).toBe(filePath);
    expect(resolved.row.nombre_archivo).toBe('OPF_901164565_FE16300.pdf');
  });

  test('encuentra el archivo en su carpeta FE{numero_factura} aunque el código actual del expediente ya no sea FE-numérico', () => {
    // La carpeta física se creó con FE{numero_factura} (fallback usado al subir el
    // primer archivo, ver expedienteZipSegment). Luego alguien editó el código del
    // expediente a un valor no-FE (ej. el código real de la factura); la carpeta en
    // disco no se renombra sola, pero el archivo debe seguir siendo encontrable.
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE777');
    fs.mkdirSync(fileDir, { recursive: true });
    const filePath = path.join(fileDir, 'CRC_901164565_FE777.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const resolved = resolveArchivoAbsoluto({
      tipo: 'CRC',
      nombre_archivo: 'CRC_901164565_FE777.pdf',
      ruta_relativa: ''
    }, {
      expediente: { id: 42, codigo: 'FACT-2026-0777', numero_factura: 777 }
    });

    expect(resolved).toBe(filePath);
  });

  test('encuentra el único archivo del tipo en la carpeta aunque su nombre no incluya el código vigente', () => {
    const fileDir = path.join(tempRoot, 'soportes', 'armado', '2026', '03', 'A_FACTURAR', 'SOPORTES', 'FE900');
    fs.mkdirSync(fileDir, { recursive: true });
    // El nombre del archivo quedó con un tag viejo que ya no coincide con nada del expediente actual.
    const filePath = path.join(fileDir, 'PDX_901164565_ALGO_VIEJO.pdf');
    fs.writeFileSync(filePath, 'pdf');

    const resolved = resolveArchivoAbsoluto({
      tipo: 'PDX',
      nombre_archivo: 'PDX_901164565_FE900.pdf',
      ruta_relativa: ''
    }, {
      expediente: { id: 900, codigo: '', numero_factura: 900 }
    });

    expect(resolved).toBe(filePath);
  });
});

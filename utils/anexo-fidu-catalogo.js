/**
 * Catálogo CUPS Anexo FIDU — caché en memoria cargada desde MySQL.
 */
const db = require('./db-mysql');

let _lista = null;
let _mapa = null;
let _cargando = null;

function normCodigoAlmacen(codigo) {
  const raw = String(codigo || '').trim().replace(/\D/g, '');
  if (!raw) return '';
  if (raw.length >= 6) return raw;
  return raw.padStart(6, '0');
}

function rowToServicio(row) {
  return {
    codigo: normCodigoAlmacen(row.codigo),
    nombre: String(row.nombre || ''),
    valor_unitario: parseInt(row.valor_unitario, 10) || 0,
    cantidad: row.cantidad != null && String(row.cantidad).trim() !== '' ? String(row.cantidad).trim() : '',
    valor_total: parseInt(row.valor_total, 10) || 0,
    codigo_servicio_referencia: String(row.codigo_servicio_referencia || '').trim()
  };
}

function aplicarCache(servicios) {
  _lista = servicios.map((s) => ({
    codigo: normCodigoAlmacen(s.codigo),
    nombre: String(s.nombre || ''),
    valor_unitario: parseInt(s.valor_unitario, 10) || 0,
    cantidad: s.cantidad != null && String(s.cantidad).trim() !== '' ? String(s.cantidad).trim() : '',
    valor_total: parseInt(s.valor_total, 10) || 0,
    codigo_servicio_referencia: String(s.codigo_servicio_referencia || '').trim()
  }));
  _mapa = new Map(_lista.map((s) => [s.codigo, s]));
}

function invalidarCatalogoAnexoFidu() {
  _lista = null;
  _mapa = null;
  _cargando = null;
}

function usarCatalogoEstatico(servicios) {
  aplicarCache(servicios);
}

function asegurarCatalogoLocal(serviciosEstaticos) {
  if (!_mapa) aplicarCache(serviciosEstaticos);
}

function buscarEnMapa(codigo) {
  if (!_mapa) return null;
  const c = String(codigo || '').trim().replace(/\D/g, '');
  if (!c) return null;
  if (_mapa.has(c)) return _mapa.get(c);
  const padded = c.padStart(6, '0');
  if (_mapa.has(padded)) return _mapa.get(padded);
  return null;
}

function listarCatalogoActivo() {
  return _lista ? [..._lista] : [];
}

async function seedAnexoFiduServiciosDesdeEstatico(dbConn, serviciosEstaticos) {
  const dbx = dbConn || db;
  const [cnt] = await dbx.query('SELECT COUNT(*) AS n FROM anexo_fidu_servicios');
  if (parseInt(cnt?.n, 10) > 0) return 0;
  let n = 0;
  for (const s of serviciosEstaticos) {
    const codigo = normCodigoAlmacen(s.codigo);
    if (!codigo) continue;
    await dbx.execute(
      `INSERT INTO anexo_fidu_servicios
        (codigo, nombre, valor_unitario, cantidad, valor_total, codigo_servicio_referencia, activo)
       VALUES (?,?,?,?,?,?,1)`,
      [
        codigo,
        String(s.nombre || '').trim(),
        parseInt(s.valor_unitario, 10) || 0,
        s.cantidad != null ? String(s.cantidad) : '',
        parseInt(s.valor_total, 10) || 0,
        String(s.codigo_servicio_referencia || '').trim()
      ]
    );
    n += 1;
  }
  return n;
}

async function recargarCatalogoAnexoFidu(dbConn, serviciosEstaticos) {
  if (_cargando) return _cargando;
  _cargando = (async () => {
    try {
      const dbx = dbConn || db;
      try {
        await seedAnexoFiduServiciosDesdeEstatico(dbx, serviciosEstaticos);
        const rows = await dbx.query(
          `SELECT codigo, nombre, valor_unitario, cantidad, valor_total, codigo_servicio_referencia
           FROM anexo_fidu_servicios WHERE activo = 1 ORDER BY codigo ASC`
        );
        if (rows.length) {
          aplicarCache(rows.map(rowToServicio));
          return _lista;
        }
      } catch (_) {
        /* tabla aún no existe o sin conexión — fallback estático */
      }
      aplicarCache(serviciosEstaticos);
      return _lista;
    } finally {
      _cargando = null;
    }
  })();
  return _cargando;
}

module.exports = {
  normCodigoAlmacen,
  invalidarCatalogoAnexoFidu,
  usarCatalogoEstatico,
  asegurarCatalogoLocal,
  buscarEnMapa,
  listarCatalogoActivo,
  seedAnexoFiduServiciosDesdeEstatico,
  recargarCatalogoAnexoFidu
};

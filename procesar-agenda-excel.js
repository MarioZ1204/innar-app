// procesar-agenda-excel.js
// Procesar Excel de disponibilidad mensual del doctor
// Columnas esperadas: FECHA | PACIENTES PROINSALUD | OTROS PACIENTES | NÚMERO TOTAL DE PACIENTES | DISPONIBILIDAD

const XLSX = require('xlsx');
const fs = require('fs');

/**
 * Procesa un archivo Excel de disponibilidad mensual del doctor
 * Estructura: FECHA | PROINSALUD | OTROS | TOTAL | DISPONIBILIDAD
 * @param {string} filePath - Ruta del archivo Excel
 * @param {number} doctorId - ID del doctor
 * @param {object} db - Conexión a base de datos
 * @returns {Promise}
 */
async function procesarAgendaExcel(filePath, doctorId, db) {
  try {
    // Leer el archivo Excel
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`[AGENDA] Procesando Excel de disponibilidad para doctor ${doctorId}...`);
    console.log(`[AGENDA] Archivo: ${filePath}, hojas disponibles: ${workbook.SheetNames.join(', ')}`);
    
    if (!data || data.length === 0) {
      return { ok: false, error: 'El Excel está vacío' };
    }

    console.log(`[AGENDA] Filas en Excel: ${data.length}, primeras 3 filas:`, data.slice(0, 3));

    // Encontrar las columnas necesarias
    const headers = Object.keys(data[0]);
    const fechaCol = encontrarColumna(headers, ['fecha', 'día', 'date']);
    const proinsaludCol = encontrarColumna(headers, ['proinsalud', 'pro insalud', 'pacientes proinsalud']);
    const otrosCol = encontrarColumna(headers, ['otros', 'otros pacientes', 'pacientes otros']);
    const totalCol = encontrarColumna(headers, ['total', 'número total', 'total pacientes']);
    const disponibilidadCol = encontrarColumna(headers, ['disponibilidad', 'disponible', 'estado']);

    // Validar que todas las columnas necesarias existan
    const columnasRequeridas = {
      'FECHA': fechaCol,
      'PACIENTES PROINSALUD': proinsaludCol,
      'OTROS PACIENTES': otrosCol,
      'NÚMERO TOTAL': totalCol,
      'DISPONIBILIDAD': disponibilidadCol
    };

    const columnasQueFaltan = Object.entries(columnasRequeridas)
      .filter(([_, col]) => !col)
      .map(([nombre]) => nombre);

    if (columnasQueFaltan.length > 0) {
      return { 
        ok: false, 
        error: `Columnas faltantes: ${columnasQueFaltan.join(', ')}. Expected: FECHA, PACIENTES PROINSALUD, OTROS PACIENTES, NÚMERO TOTAL, DISPONIBILIDAD` 
      };
    }

    // Limpiar días anteriores del doctor para este mes
    const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
    await db.execute(
      'DELETE FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND DATE_FORMAT(fecha, "%Y-%m") = ?',
      [doctorId, mesActual]
    );

    // Procesar cada fila
    let diasGuardados = 0;
    let diasConError = [];

    for (let idx = 0; idx < data.length; idx++) {
      const row = data[idx];
      
      try {
        // Parsear datos
        const fechaStr = row[fechaCol];
        const proinsalud = parseInt(row[proinsaludCol]) || 0;
        const otros = parseInt(row[otrosCol]) || 0;
        const total = parseInt(row[totalCol]) || 0;
        const disponibilidad = (row[disponibilidadCol] || '').toString().trim().toUpperCase();

        // Validar fecha
        const fecha = parseExcelDate(fechaStr);
        if (!fecha) {
          diasConError.push(`Fila ${idx + 2}: Fecha inválida "${fechaStr}"`);
          continue;
        }

        const fechaFormato = fecha.toISOString().split('T')[0]; // YYYY-MM-DD

        // Validar disponibilidad
        const esDisponible = disponibilidad === 'DISPONIBLE' || disponibilidad === 'SÍ' || disponibilidad === 'SI';
        
        console.log(`[AGENDA] Fila ${idx + 2}: fecha=${fechaFormato}, proinsalud=${proinsalud}, otros=${otros}, total=${total}, disponible=${esDisponible} (disponibilidad="${disponibilidad}")`);
        
        // Guardar en BD
        await db.execute(
          `INSERT INTO doctor_disponibilidad_mensual 
           (doctor_id, fecha, pacientes_proinsalud, pacientes_otros, total_pacientes, disponible) 
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
           pacientes_proinsalud = ?, pacientes_otros = ?, total_pacientes = ?, disponible = ?`,
          [doctorId, fechaFormato, proinsalud, otros, total, esDisponible ? 1 : 0,
           proinsalud, otros, total, esDisponible ? 1 : 0]
        );

        diasGuardados++;
      } catch (err) {
        diasConError.push(`Fila ${idx + 2}: ${err.message}`);
      }
    }

    console.log(`[AGENDA] ✓ ${diasGuardados} días guardados para doctor ${doctorId}`);
    
    if (diasConError.length > 0) {
      console.warn('[AGENDA] Errores encontrados:', diasConError);
    }

    return { 
      ok: true, 
      diasGuardados,
      errores: diasConError.length > 0 ? diasConError : null
    };
  } catch (error) {
    console.error('[AGENDA] Error procesando Excel:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * Encuentra una columna por múltiples variaciones de nombre
 */
function encontrarColumna(headers, variaciones) {
  for (const variacion of variaciones) {
    const encontrada = headers.find(h => 
      h.toLowerCase().includes(variacion.toLowerCase())
    );
    if (encontrada) return encontrada;
  }
  return null;
}

/**
 * Parsea una fecha del Excel
 */
function parseExcelDate(dateValue) {
  if (!dateValue) return null;

  // Si es un número (serial de Excel)
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(excelEpoch.getTime() + (dateValue - 2) * 24 * 60 * 60 * 1000);
    return date;
  }

  // Si es string, intentar parsear
  if (typeof dateValue === 'string') {
    let date = null;
    
    // Probar formatos en orden: YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY
    // YYYY-MM-DD
    let match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      date = new Date(match[1], parseInt(match[2]) - 1, match[3]);
      return date && !isNaN(date.getTime()) ? date : null;
    }
    
    // DD/MM/YYYY
    match = dateValue.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      date = new Date(match[3], parseInt(match[2]) - 1, match[1]);
      return date && !isNaN(date.getTime()) ? date : null;
    }
    
    // MM-DD-YYYY (formato por defecto de Excel en inglés)
    match = dateValue.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
      date = new Date(match[3], parseInt(match[1]) - 1, match[2]);
      return date && !isNaN(date.getTime()) ? date : null;
    }

    return null;
  }

  return null;
}

/**
 * Obtiene la disponibilidad mensual de un doctor
 */
async function obtenerDisponibilidadMensual(doctorId, mes = null, db) {
  try {
    let query = 'SELECT * FROM doctor_disponibilidad_mensual WHERE doctor_id = ?';
    let params = [doctorId];

    if (mes) {
      query += ' AND DATE_FORMAT(fecha, "%Y-%m") = ?';
      params.push(mes);
    }

    query += ' ORDER BY fecha ASC';

    const result = await db.execute(query, params);
    return result;
  } catch (error) {
    console.error('[AGENDA] Error obteniendo disponibilidad:', error.message);
    return [];
  }
}

/**
 * Verifica si un doctor tiene disponibilidad en una fecha específica
 */
async function tieneDisponibilidad(doctorId, fecha, db) {
  try {
    const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
    
    const result = await db.execute(
      `SELECT disponible, total_pacientes FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctorId, fechaFormato]
    );
    
    if (result.length === 0) {
      // Si no existe registro, asumir que está disponible
      return { disponible: true, razon: 'Sin restricciones' };
    }

    const registro = result[0];
    return {
      disponible: registro.disponible === 1,
      totalPacientes: registro.total_pacientes,
      razon: !registro.disponible ? 'Doctor no disponible' : null
    };
  } catch (error) {
    console.error('[AGENDA] Error verificando disponibilidad:', error.message);
    return { disponible: true, razon: null };
  }
}

/**
 * Limpiar disponibilidad de un doctor
 */
async function limpiarDisponibilidad(doctorId, db) {
  try {
    await db.execute(
      'DELETE FROM doctor_disponibilidad_mensual WHERE doctor_id = ?',
      [doctorId]
    );
    return { ok: true };
  } catch (error) {
    console.error('[AGENDA] Error limpiando disponibilidad:', error.message);
    return { ok: false, error: error.message };
  }
}

// Para compatibilidad con código anterior
async function obtenerDiasBloqueados(doctorId, db) {
  const disp = await obtenerDisponibilidadMensual(doctorId, null, db);
  return disp.filter(d => !d.disponible).map(d => d.fecha.toISOString().split('T')[0]);
}

async function estaFechaBloqueada(doctorId, fecha, db) {
  const resultado = await tieneDisponibilidad(doctorId, fecha, db);
  return !resultado.disponible;
}

module.exports = {
  procesarAgendaExcel,
  obtenerDisponibilidadMensual,
  tieneDisponibilidad,
  limpiarDisponibilidad,
  // Compatibilidad anterior
  obtenerDiasBloqueados,
  estaFechaBloqueada
};

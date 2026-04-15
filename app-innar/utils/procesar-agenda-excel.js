// procesar-agenda-excel.js
// Procesar Excel de disponibilidad mensual del doctor
// Columnas esperadas: FECHA | PACIENTES PROINSALUD | OTROS PACIENTES | NÚMERO TOTAL DE PACIENTES | DISPONIBILIDAD

const XLSX = require('xlsx');
const fs = require('fs');

/**
 * Procesa un archivo Excel de disponibilidad mensual del doctor
 * Estructura OBLIGATORIA: FECHA | MAÑANA | TARDE
 * Estructura OPCIONAL: + INTERVALO | RAZÓN (define espacios específicos bloqueados dentro del turno)
 * 
 * El sistema es COMBINADO:
 * 1. MAÑANA/TARDE define disponibilidad general del turno
 * 2. INTERVALO/RAZÓN define bloques específicos DENTRO de ese turno
 * 
 * Ejemplo:
 *   FECHA        | MAÑANA | TARDE | INTERVALO     | RAZÓN
 *   2026-02-23   | SÍ     | NO    | 07:00-09:00   | Con estudiantes
 *   Resultado: Turno tarde NO disponible, mañana disponible entre 09:00-12:00
 * 
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
    console.log(`[AGENDA] Headers encontrados:`, headers);
    
    // OBLIGATORIAS
    const fechaCol = encontrarColumna(headers, ['fecha', 'día', 'date']);
    const mañanaCol = encontrarColumna(headers, ['mañana', 'manana', 'morning', 'matutino']);
    const tardeCol = encontrarColumna(headers, ['tarde', 'afternoon', 'vespertino']);
    
    // OPCIONALES (para intervalos específicos)
    const intervaloCol = encontrarColumna(headers, ['intervalo', 'no disponible', 'bloque', 'horario']);
    const razonCol = encontrarColumna(headers, ['razón', 'razon', 'motivo', 'reason']);
    
    const tieneIntervalos = intervaloCol && razonCol;
    
    console.log(`[AGENDA] Sistema detectado: ${tieneIntervalos ? 'COMBINADO (mañana/tarde + intervalos)' : 'CLÁSICO (mañana/tarde)'}`);

    // Validar columnas OBLIGATORIAS
    const columnasObligatorias = [];
    if (!fechaCol) columnasObligatorias.push('FECHA');
    if (!mañanaCol) columnasObligatorias.push('MAÑANA');
    if (!tardeCol) columnasObligatorias.push('TARDE');

    if (columnasObligatorias.length > 0) {
      return { 
        ok: false, 
        error: `Columnas OBLIGATORIAS faltantes: ${columnasObligatorias.join(', ')}. El Excel debe tener: FECHA, MAÑANA, TARDE. Headers encontrados: ${headers.join(', ')}`
      };
    }

    // Limpiar dias anteriores del doctor para este mes
    const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
    await db.execute(
      'DELETE FROM doctor_disponibilidad_mensual WHERE doctor_id = ? AND DATE_FORMAT(fecha, "%Y-%m") = ?',
      [doctorId, mesActual]
    );
    
    // Si hay intervalos, también limpiar esos
    if (tieneIntervalos) {
      await db.execute(
        'DELETE FROM doctor_disponibilidad_intervalos WHERE doctor_id = ? AND DATE_FORMAT(fecha, "%Y-%m") = ?',
        [doctorId, mesActual]
      );
    }

    // Procesar cada fila
    let diasGuardados = 0;
    let intervalosGuardados = 0;
    let diasConError = [];

    for (let idx = 0; idx < data.length; idx++) {
      const row = data[idx];
      
      try {
        const fechaStr = row[fechaCol];
        
        // Validar fecha
        const fecha = parseExcelDate(fechaStr);
        if (!fecha) {
          diasConError.push(`Fila ${idx + 2}: Fecha inválida "${fechaStr}"`);
          continue;
        }

        const fechaFormato = fecha.toISOString().split('T')[0]; // YYYY-MM-DD

        // PASO 1: SIEMPRE leer MAÑANA/TARDE (obligatorio)
        const mañanaStr = (row[mañanaCol] || '').toString().trim().toUpperCase();
        const tardeStr = (row[tardeCol] || '').toString().trim().toUpperCase();

        const esMañanaDisponible = mañanaStr === 'SÍ' || mañanaStr === 'SI' || mañanaStr === '1' || mañanaStr === 'DISPONIBLE';
        const esTardeDisponible = tardeStr === 'SÍ' || tardeStr === 'SI' || tardeStr === '1' || tardeStr === 'DISPONIBLE';
        
        console.log(`[AGENDA] Fila ${idx + 2}: fecha=${fechaFormato}, mañana=${esMañanaDisponible}, tarde=${esTardeDisponible}`);
        
        // Guardar disponibilidad general de turno
        await db.execute(
          `INSERT INTO doctor_disponibilidad_mensual 
           (doctor_id, fecha, disponible_manana, disponible_tarde) 
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE disponible_manana = ?, disponible_tarde = ?`,
          [doctorId, fechaFormato, esMañanaDisponible ? 1 : 0, esTardeDisponible ? 1 : 0,
           esMañanaDisponible ? 1 : 0, esTardeDisponible ? 1 : 0]
        );
        diasGuardados++;

        // PASO 2: Si hay intervalos, guardar como refinamiento DENTRO de los turnos disponibles
        if (tieneIntervalos) {
          const intervaloStr = (row[intervaloCol] || '').toString().trim();
          const razonStr = (row[razonCol] || '').toString().trim();

          if (intervaloStr) {
            // Parsear intervalo "07:00-09:00"
            const intervaloParsed = parseIntervalo(intervaloStr);
            if (!intervaloParsed) {
              diasConError.push(`Fila ${idx + 2}: Intervalo inválido "${intervaloStr}"`);
              continue;
            }

            // Validar que el intervalo esté dentro de un turno disponible
            const [inicioH] = intervaloStr.split('-')[0].split(':').map(x => parseInt(x, 10));
            const esMañana = inicioH >= 7 && inicioH < 13;
            const esTarde = inicioH >= 14 && inicioH < 19;

            let esValido = false;
            let razonInvalidez = null;

            if (esMañana && !esMañanaDisponible) {
              razonInvalidez = 'El intervalo está en la mañana pero MAÑANA está marcado como NO disponible';
            } else if (esTarde && !esTardeDisponible) {
              razonInvalidez = 'El intervalo está en la tarde pero TARDE está marcado como NO disponible';
            } else if (!esMañana && !esTarde) {
              razonInvalidez = 'El intervalo está fuera del horario permitido (7:00-12:00 o 14:00-18:00)';
            } else {
              esValido = true;
            }

            if (!esValido) {
              diasConError.push(`Fila ${idx + 2}: ${razonInvalidez}`);
              continue;
            }

            // Guardar intervalo bloqueado
            await db.execute(
              `INSERT INTO doctor_disponibilidad_intervalos 
               (doctor_id, fecha, hora_inicio, hora_fin, razon)
               VALUES (?, ?, ?, ?, ?)`,
              [doctorId, fechaFormato, intervaloParsed.inicio, intervaloParsed.fin, razonStr || null]
            );
            
            intervalosGuardados++;
            console.log(`[AGENDA] Fila ${idx + 2}: intervalo=${intervaloStr}, razón=${razonStr}`);
          }
        }
        
      } catch (err) {
        diasConError.push(`Fila ${idx + 2}: ${err.message}`);
      }
    }

    const mensaje = tieneIntervalos 
      ? `✓ ${diasGuardados} días y ${intervalosGuardados} intervalos guardados` 
      : `✓ ${diasGuardados} días guardados`;
    console.log(`[AGENDA] ${mensaje} para doctor ${doctorId}`);
    
    if (diasConError.length > 0) {
      console.warn('[AGENDA] Errores encontrados:', diasConError);
    }

    return { 
      ok: true, 
      diasGuardados,
      intervalosGuardados: tieneIntervalos ? intervalosGuardados : 0,
      formato: tieneIntervalos ? 'combinado' : 'clasico',
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
 * Parsea un intervalo de tiempo "HH:MM-HH:MM" a formato TIME de MySQL
 * Ejemplo: "07:00-09:00" => { inicio: "07:00:00", fin: "09:00:00" }
 */
function parseIntervalo(intervaloStr) {
  if (!intervaloStr) return null;
  
  const partes = intervaloStr.trim().split('-');
  if (partes.length !== 2) return null;
  
  const inicio = partes[0].trim();
  const fin = partes[1].trim();
  
  // Validar formato HH:MM
  const regexTime = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
  if (!regexTime.test(inicio) || !regexTime.test(fin)) {
    return null;
  }
  
  return {
    inicio: `${inicio}:00`,  // Agregar segundos
    fin: `${fin}:00`         // Agregar segundos
  };
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
 * Verifica si un doctor tiene disponibilidad en una fecha específica con validación de horario
 * Validación COMBINADA: MAÑANA/TARDE obligatorio, luego intervalos específicos como refinamiento
 * 
 * Proceso:
 * 1. Verficiar que el día esté disponible enn general (MAÑANA/TARDE)
 * 2. Verificar que la hora NO caiga en un intervalo bloqueado
 */
async function validarDisponibilidadPorHora(doctorId, fecha, hora, db) {
  try {
    const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
    
    const result = await db.execute(
      `SELECT disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctorId, fechaFormato]
    );
    
    // Si no existe registro, asumir que está disponible todo el día
    if (result.length === 0) {
      console.log(`[DISPONIBILIDAD] Sin registro para doctor=${doctorId}, fecha=${fechaFormato} - permitiendo`);
      return { valido: true, razon: null };
    }

    const registro = result[0];
    // Convertir a booleano con múltiples validaciones
    const disponibleManana = Boolean(registro.disponible_manana);
    const disponibleTarde = Boolean(registro.disponible_tarde);

    console.log(`[DISPONIBILIDAD] Registro completo:`, JSON.stringify(registro));
    console.log(`[DISPONIBILIDAD] Doctor ${doctorId}, fecha ${fechaFormato}: Mañana=${disponibleManana} (raw: ${registro.disponible_manana}), Tarde=${disponibleTarde} (raw: ${registro.disponible_tarde})`);

    // PASO 1: Validar que el turno esté disponible en general
    if (!disponibleManana && !disponibleTarde) {
      console.log(`[DISPONIBILIDAD] Rechazando: ambos turnos NO disponibles`);
      return { 
        valido: false, 
        razon: 'El doctor no está disponible en esta fecha' 
      };
    }

    // Parsear hora (formato HH:MM)
    const [horaStr, minStr] = (hora || '').split(':');
    const horaNum = parseInt(horaStr, 10);
    const minNum = parseInt(minStr || '0', 10);

    console.log(`[DISPONIBILIDAD] Validando hora ${horaNum}:${(minStr || '00').padStart(2, '0')}`);

    // Validar horario de la mañana (7:00-12:59) - INCLUSIVE hasta las 12:59
    if ((horaNum === 7 || horaNum === 8 || horaNum === 9 || horaNum === 10 || horaNum === 11) || (horaNum === 12 && minNum <= 59)) {
      console.log(`[DISPONIBILIDAD] Hora está en rango MAÑANA (7:00-12:59). Disponible mañana: ${disponibleManana}`);
      if (!disponibleManana) {
        console.log(`[DISPONIBILIDAD] Rechazando: no disponible en la mañana`);
        return { 
          valido: false, 
          razon: 'El doctor no está disponible en la mañana (7:00-12:00) en esta fecha' 
        };
      }
    } 
    // Validar horario de la tarde (14:00-18:59) - INCLUSIVE hasta las 18:59
    else if ((horaNum === 14 || horaNum === 15 || horaNum === 16 || horaNum === 17) || (horaNum === 18 && minNum <= 59)) {
      console.log(`[DISPONIBILIDAD] Hora está en rango TARDE (14:00-18:59). Disponible tarde: ${disponibleTarde}`);
      if (!disponibleTarde) {
        console.log(`[DISPONIBILIDAD] Rechazando: no disponible en la tarde`);
        return { 
          valido: false, 
          razon: 'El doctor no está disponible en la tarde (14:00-18:00) en esta fecha' 
        };
      }
    } 
    // Rango fuera de horario (13:00-13:59 es descanso/almuerzo)
    else {
      console.log(`[DISPONIBILIDAD] Hora ${horaNum}:${(minStr || '00').padStart(2, '0')} está fuera del rango permitido`);
      return { 
        valido: false, 
        razon: 'Hora fuera del rango disponible. Horarios: Mañana (7:00-12:00) o Tarde (14:00-18:00)' 
      };
    }

    // PASO 2: Validar que la hora NO caiga en un intervalo bloqueado
    const {intervalos, existe_registro: tiene_intervalos} = await consultarIntervalosNoDisponibles(doctorId, fechaFormato, db);
    if (tiene_intervalos) {
      const {bloqueado, razon} = esHoraBloqueada(hora, intervalos);
      if (bloqueado) {
        console.log(`[DISPONIBILIDAD] Rechazando: hora ${hora} cae en intervalo bloqueado: ${razon}`);
        return { valido: false, razon };
      }
    }

    console.log(`[DISPONIBILIDAD] Permitiendo cita: validación pasada (turno disponible, no está en intervalo bloqueado)`);
    return { valido: true, razon: null };
  } catch (error) {
    console.error('[DISPONIBILIDAD] Error validando disponibilidad por hora:', error.message);
    return { valido: true, razon: null }; // En caso de error, permitir
  }
}

/**
 * Verifica si un doctor tiene disponibilidad en una fecha específica
 */
async function tieneDisponibilidad(doctorId, fecha, db) {
  try {
    const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
    
    const result = await db.execute(
      `SELECT disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctorId, fechaFormato]
    );
    
    if (result.length === 0) {
      // Si no existe registro, asumir que está disponible
      return { disponible: true, razon: 'Sin restricciones' };
    }

    const registro = result[0];
    // Convertir a booleano
    const disponibleManana = Boolean(registro.disponible_manana);
    const disponibleTarde = Boolean(registro.disponible_tarde);
    
    // Disponible si al menos uno de los turnos está disponible
    const disponible = disponibleManana || disponibleTarde;
    
    return {
      disponible: disponible,
      totalPacientes: null,
      razon: !disponible ? 'Doctor no disponible' : null
    };
  } catch (error) {
    console.error('[AGENDA] Error verificando disponibilidad:', error.message);
    return { disponible: true, razon: null };
  }
}

/**
 * Consulta los intervalos no disponibles de un doctor para una fecha específica
 * @returns { intervalos: Array, existe_registro: Boolean }
 */
async function consultarIntervalosNoDisponibles(doctorId, fecha, db) {
  try {
    const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
    
    const result = await db.execute(
      `SELECT hora_inicio, hora_fin, razon FROM doctor_disponibilidad_intervalos
       WHERE doctor_id = ? AND fecha = ?
       ORDER BY hora_inicio ASC`,
      [doctorId, fechaFormato]
    );

    return {
      intervalos: result || [],
      existe_registro: result.length > 0
    };
  } catch (error) {
    console.error('[AGENDA] Error consultando intervalos:', error.message);
    return { intervalos: [], existe_registro: false };
  }
}

/**
 * Verifica si una hora específica cae dentro de un intervalo no disponible
 * @param {string} hora - Hora en formato HH:MM
 * @param {Array} intervalos - Array de intervalos con hora_inicio y hora_fin
 * @returns { bloqueado: Boolean, razon: String }
 */
function esHoraBloqueada(hora, intervalos) {
  if (!intervalos || intervalos.length === 0) {
    return { bloqueado: false, razon: null };
  }

  const [horaStr, minStr] = (hora || '').split(':');
  const horaNum = parseInt(horaStr, 10);
  const minNum = parseInt(minStr || '0', 10);
  
  // Convertir a minutos desde medianoche para comparación
  const minutosCita = horaNum * 60 + minNum;

  for (const intervalo of intervalos) {
    // Parsear hora_inicio y hora_fin (formato TIME "HH:MM:SS")
    const [inicioHora, inicioMin] = intervalo.hora_inicio.split(':').map(x => parseInt(x, 10));
    const [finHora, finMin] = intervalo.hora_fin.split(':').map(x => parseInt(x, 10));
    
    const minutosInicio = inicioHora * 60 + inicioMin;
    const minutosFin = finHora * 60 + finMin;
    
    // Verificar si la cita está dentro del intervalo bloqueado
    if (minutosCita >= minutosInicio && minutosCita < minutosFin) {
      return {
        bloqueado: true,
        razon: intervalo.razon || 'No disponible en este horario'
      };
    }
  }

  return { bloqueado: false, razon: null };
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
  validarDisponibilidadPorHora,
  consultarIntervalosNoDisponibles,
  esHoraBloqueada,
  limpiarDisponibilidad,
  parseIntervalo,
  // Compatibilidad anterior
  obtenerDiasBloqueados,
  estaFechaBloqueada
};

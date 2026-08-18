// procesar-agenda-excel.js
// Procesar Excel de disponibilidad mensual del doctor
// Columnas esperadas: FECHA | PACIENTES PROINSALUD | OTROS PACIENTES | NÚMERO TOTAL DE PACIENTES | DISPONIBILIDAD

const ExcelJS = require('exceljs');
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
    // Leer el archivo Excel con exceljs
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];

    // Convertir a array de objetos (primera fila = cabeceras)
    const headers = [];
    const data = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.values.forEach((val) => headers.push(val !== null && val !== undefined ? String(val) : ''));
        return;
      }
      const obj = {};
      row.values.forEach((val, colIdx) => {
        const key = headers[colIdx] || '';
        if (key) obj[key] = val !== null && val !== undefined ? val : null;
      });
      // Solo incluir filas que tengan algún valor
      if (Object.values(obj).some(v => v !== null)) data.push(obj);
    });

    console.log(`[AGENDA] Procesando Excel de disponibilidad para doctor ${doctorId}...`);
    console.log(`[AGENDA] Archivo: ${filePath}, hoja: ${worksheet.name}`);
    
    if (!data || data.length === 0) {
      return { ok: false, error: 'El Excel está vacío' };
    }

    console.log(`[AGENDA] Filas en Excel: ${data.length}, primeras 3 filas:`, data.slice(0, 3));

    // Encontrar las columnas necesarias
    const colKeys = data.length > 0 ? Object.keys(data[0]) : [];
    console.log(`[AGENDA] Headers encontrados:`, colKeys);
    
    // OBLIGATORIAS
    const fechaCol = encontrarColumna(colKeys, ['fecha', 'día', 'date']);
    const mañanaCol = encontrarColumna(colKeys, ['mañana', 'manana', 'morning', 'matutino']);
    const tardeCol = encontrarColumna(colKeys, ['tarde', 'afternoon', 'vespertino']);
    const proinsaludCol = encontrarColumna(colKeys, ['pacientes proinsalud', 'proinsalud']);
    const otrosPacientesCol = encontrarColumna(colKeys, ['otros pacientes', 'pacientes otros', 'otros']);
    const totalPacientesCol = encontrarColumna(colKeys, ['número total de pacientes', 'numero total de pacientes', 'total de pacientes', 'total pacientes']);
    
    // OPCIONALES (para intervalos específicos)
    const intervaloCol = encontrarColumna(colKeys, ['intervalo', 'no disponible', 'bloque', 'horario']);
    const razonCol = encontrarColumna(colKeys, ['razón', 'razon', 'motivo', 'reason']);
    
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
        const pacientesProinsalud = parsePositiveInt(row[proinsaludCol]);
        const pacientesOtros = parsePositiveInt(row[otrosPacientesCol]);
        const totalPacientes = parsePositiveInt(row[totalPacientesCol]) || pacientesProinsalud + pacientesOtros;

        const esMañanaDisponible = mañanaStr === 'SÍ' || mañanaStr === 'SI' || mañanaStr === '1' || mañanaStr === 'DISPONIBLE';
        const esTardeDisponible = tardeStr === 'SÍ' || tardeStr === 'SI' || tardeStr === '1' || tardeStr === 'DISPONIBLE';
        
        console.log(`[AGENDA] Fila ${idx + 2}: fecha=${fechaFormato}, mañana=${esMañanaDisponible}, tarde=${esTardeDisponible}`);
        
        // Guardar disponibilidad general de turno
        await db.execute(
          `INSERT INTO doctor_disponibilidad_mensual 
           (doctor_id, fecha, disponible_manana, disponible_tarde, pacientes_proinsalud, pacientes_otros, total_pacientes) 
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE disponible_manana = ?, disponible_tarde = ?, pacientes_proinsalud = ?, pacientes_otros = ?, total_pacientes = ?`,
          [doctorId, fechaFormato, esMañanaDisponible ? 1 : 0, esTardeDisponible ? 1 : 0,
           pacientesProinsalud, pacientesOtros, totalPacientes,
           esMañanaDisponible ? 1 : 0, esTardeDisponible ? 1 : 0,
           pacientesProinsalud, pacientesOtros, totalPacientes]
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

function parsePositiveInt(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
    const run = typeof db.query === 'function'
      ? (sql, params) => db.query(sql, params)
      : (sql, params) => db.execute(sql, params);

    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      const y = parseInt(mes.slice(0, 4), 10);
      const m = parseInt(mes.slice(5, 7), 10);
      const fechaIni = `${mes}-01`;
      const endY = m === 12 ? y + 1 : y;
      const endM = m === 12 ? 1 : m + 1;
      const fechaFinExcl = `${endY}-${String(endM).padStart(2, '0')}-01`;
      // Rango de fechas (evita DATE_FORMAT con "%Y-%m" que rompe si ANSI_QUOTES está activo en Hostinger).
      const rows = await run(
        `SELECT * FROM doctor_disponibilidad_mensual
         WHERE doctor_id = ? AND fecha >= ? AND fecha < ?
         ORDER BY fecha ASC`,
        [doctorId, fechaIni, fechaFinExcl]
      );
      return Array.isArray(rows) ? rows : [];
    }

    const rows = await run(
      'SELECT * FROM doctor_disponibilidad_mensual WHERE doctor_id = ? ORDER BY fecha ASC',
      [doctorId]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('[AGENDA] Error obteniendo disponibilidad:', error.message);
    return [];
  }
}

function horaAMinutos(hora) {
  const [h, m] = String(hora || '').slice(0, 5).split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function horaCaeEnSlotAgenda(hora, slot) {
  const t = horaAMinutos(hora);
  const ini = horaAMinutos(slot.hora_inicio);
  const fin = horaAMinutos(slot.hora_fin);
  if (t === null || ini === null || fin === null) return false;
  return t >= ini && t < fin;
}

/** Jornada por defecto (sin doctor_agenda): mismo criterio exclusivo que 08:00-12:00 / 14:00-18:00. */
const SLOT_MANANA_DEFAULT = { hora_inicio: '07:00', hora_fin: '12:00' };
const SLOT_TARDE_DEFAULT = { hora_inicio: '14:00', hora_fin: '18:00' };

function jornadaDefaultDeHora(hora) {
  if (horaCaeEnSlotAgenda(hora, SLOT_MANANA_DEFAULT)) return 'manana';
  if (horaCaeEnSlotAgenda(hora, SLOT_TARDE_DEFAULT)) return 'tarde';
  return null;
}

async function consultarSlotsAgendaDia(doctorId, fecha, db) {
  const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];
  const rows = await db.execute(
    `SELECT hora_inicio, hora_fin FROM doctor_agenda
     WHERE doctor_id = ? AND fecha = ? AND disponible = 1
     ORDER BY hora_inicio ASC`,
    [doctorId, fechaFormato]
  );
  return rows || [];
}

function parseFlagDisponible(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (val === false || val === 0 || val === '0' || val === 'false') return false;
  return null;
}

/** Misma semántica que GET /api/doctor-disponibilidad: null en mañana/tarde = disponible. */
function flagsDisponibilidadMananaTarde(registro) {
  const dm = parseFlagDisponible(registro?.disponible_manana);
  const dt = parseFlagDisponible(registro?.disponible_tarde);
  return {
    mananaOk: dm === null ? true : dm === true,
    tardeOk: dt === null ? true : dt === true
  };
}

/**
 * Verifica disponibilidad por hora: día disponible, slots de agenda (si existen), mañana/tarde, intervalos bloqueados.
 */
async function validarDisponibilidadPorHora(doctorId, fecha, hora, db) {
  try {
    const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];

    const result = await db.execute(
      `SELECT disponible, disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctorId, fechaFormato]
    );

    if (result.length === 0) {
      return { valido: true, razon: null };
    }

    const registro = result[0];
    const dispDia = parseFlagDisponible(registro.disponible);
    if (dispDia === false) {
      return { valido: false, razon: 'El doctor no asistirá en esta fecha' };
    }

    const { mananaOk, tardeOk } = flagsDisponibilidadMananaTarde(registro);

    if (!mananaOk && !tardeOk) {
      return { valido: false, razon: 'El doctor no está disponible en esta fecha' };
    }

    const slots = await consultarSlotsAgendaDia(doctorId, fechaFormato, db);
    if (slots.length > 0) {
      const enSlot = slots.some((s) => horaCaeEnSlotAgenda(hora, s));
      if (!enSlot) {
        const rangos = slots.map((s) => `${String(s.hora_inicio).slice(0, 5)}-${String(s.hora_fin).slice(0, 5)}`).join(', ');
        return {
          valido: false,
          razon: `La hora no está dentro de los horarios configurados (${rangos})`
        };
      }
    } else {
      const jornada = jornadaDefaultDeHora(hora);
      if (jornada === 'manana') {
        if (!mananaOk) {
          return { valido: false, razon: 'El doctor no está disponible en la mañana (7:00-12:00) en esta fecha' };
        }
      } else if (jornada === 'tarde') {
        if (!tardeOk) {
          return { valido: false, razon: 'El doctor no está disponible en la tarde (14:00-18:00) en esta fecha' };
        }
      } else {
        return {
          valido: false,
          razon: 'Hora fuera del rango disponible. Horarios: Mañana (7:00-12:00) o Tarde (14:00-18:00)'
        };
      }
    }

    const { intervalos, existe_registro: tiene_intervalos } = await consultarIntervalosNoDisponibles(doctorId, fechaFormato, db);
    if (tiene_intervalos) {
      const { bloqueado, razon } = esHoraBloqueada(hora, intervalos);
      if (bloqueado) {
        return { valido: false, razon };
      }
    }

    return { valido: true, razon: null };
  } catch (error) {
    console.error('[DISPONIBILIDAD] Error validando disponibilidad por hora:', error.message);
    return { valido: false, razon: 'No se pudo validar la disponibilidad. Intente de nuevo.' };
  }
}

/**
 * Verifica si un doctor tiene disponibilidad en una fecha específica
 */
async function tieneDisponibilidad(doctorId, fecha, db) {
  try {
    const fechaFormato = typeof fecha === 'string' ? fecha : fecha.toISOString().split('T')[0];

    const result = await db.execute(
      `SELECT disponible, disponible_manana, disponible_tarde FROM doctor_disponibilidad_mensual
       WHERE doctor_id = ? AND fecha = ?`,
      [doctorId, fechaFormato]
    );

    if (result.length === 0) {
      return { disponible: true, razon: 'Sin restricciones' };
    }

    const registro = result[0];
    if (parseFlagDisponible(registro.disponible) === false) {
      return { disponible: false, razon: 'El doctor no asistirá en esta fecha' };
    }

    const disponibleManana = parseFlagDisponible(registro.disponible_manana) === true;
    const disponibleTarde = parseFlagDisponible(registro.disponible_tarde) === true;
    const disponible = disponibleManana || disponibleTarde;

    return {
      disponible,
      totalPacientes: null,
      razon: !disponible ? 'Doctor no disponible' : null
    };
  } catch (error) {
    console.error('[AGENDA] Error verificando disponibilidad:', error.message);
    return { disponible: false, razon: 'No se pudo verificar la disponibilidad' };
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

function normalizarHoraHHMM(hora) {
  if (!hora) return null;
  const s = String(hora).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}`;
}

/** Normaliza hora guardada en turnos (TIME, 24h o 12h AM/PM). */
function normalizarHoraDesdeTurno(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  let h = normalizarHoraHHMM(s);
  if (h) return h;
  const m12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (m12) {
    let hh = parseInt(m12[1], 10);
    const mm = m12[2];
    if (m12[3].toUpperCase() === 'AM') { if (hh === 12) hh = 0; }
    else { if (hh !== 12) hh += 12; }
    return `${String(hh).padStart(2, '0')}:${mm}`;
  }
  return null;
}

function conflictoSesionConOtrasEnPlan(fecha, horaNorm, sesionNumero, primeraSesion, todasSesiones) {
  if (!fecha || !horaNorm) return { conflicto: false };
  const f = String(fecha).slice(0, 10);
  if (primeraSesion?.fecha && primeraSesion?.hora) {
    const f1 = String(primeraSesion.fecha).slice(0, 10);
    const h1 = normalizarHoraHHMM(primeraSesion.hora) || normalizarHoraDesdeTurno(primeraSesion.hora);
    if (sesionNumero > 1 && f1 === f && h1 === horaNorm) {
      return { conflicto: true, razon: 'Misma fecha y hora que la 1.ª sesión' };
    }
  }
  for (const s of todasSesiones || []) {
    const num = parseInt(s.sesion_numero, 10);
    if (num === sesionNumero || num < 2) continue;
    const f2 = String(s.fecha || '').slice(0, 10);
    const h2 = normalizarHoraHHMM(s.hora) || normalizarHoraDesdeTurno(s.hora);
    if (f2 === f && h2 === horaNorm) {
      return { conflicto: true, razon: `Duplicada con la sesión ${num}` };
    }
  }
  return { conflicto: false };
}

/**
 * Indica si ya hay otra cita activa del médico en esa fecha y hora (HH:MM).
 */
async function consultarOcupacionHora(doctorId, fecha, hora, db) {
  const horaNorm = normalizarHoraHHMM(hora) || normalizarHoraDesdeTurno(hora);
  if (!horaNorm) return { ocupada: false, turnos: [] };
  const fechaFmt = String(fecha).slice(0, 10);
  const rows = await db.query(
    `SELECT id, paciente_nombre, hora FROM turnos
     WHERE doctor_id = ? AND fecha = ?
       AND estado NOT IN ('CANCELADO', 'REPROGRAMADO')
       AND hora IS NOT NULL AND TRIM(CAST(hora AS CHAR)) <> ''`,
    [doctorId, fechaFmt]
  );
  const turnos = rows.filter((r) => normalizarHoraDesdeTurno(r.hora) === horaNorm);
  return { ocupada: turnos.length > 0, turnos };
}

/** Horas libres en el día (sin cita activa y con disponibilidad del médico). */
async function listarHorasLibresAgendaDia(doctorId, fecha, db, intervaloMin = 40) {
  const turnosRows = await db.query(
    `SELECT TIME_FORMAT(hora, '%H:%i') AS h FROM turnos
     WHERE doctor_id = ? AND fecha = ?
       AND estado NOT IN ('CANCELADO', 'REPROGRAMADO')
       AND hora IS NOT NULL AND hora != ''`,
    [doctorId, fecha]
  );
  const ocupadas = new Set(
    turnosRows.map((r) => normalizarHoraDesdeTurno(r.h) || String(r.h || '').slice(0, 5)).filter(Boolean)
  );
  const libres = [];
  const rangos = [{ inicio: 7 * 60, fin: 12 * 60 }, { inicio: 14 * 60, fin: 18 * 60 }];
  const paso = Math.min(60, Math.max(15, parseInt(intervaloMin, 10) || 40));
  for (const rango of rangos) {
    let m = rango.inicio;
    while (m < rango.fin) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const hStr = `${hh}:${mm}`;
      if (!ocupadas.has(hStr)) {
        const validacion = await validarDisponibilidadPorHora(doctorId, fecha, hStr, db);
        if (validacion.valido) libres.push(hStr);
      }
      m += paso;
    }
  }
  return libres;
}

module.exports = {
  procesarAgendaExcel,
  obtenerDisponibilidadMensual,
  tieneDisponibilidad,
  validarDisponibilidadPorHora,
  consultarSlotsAgendaDia,
  horaCaeEnSlotAgenda,
  jornadaDefaultDeHora,
  consultarIntervalosNoDisponibles,
  esHoraBloqueada,
  limpiarDisponibilidad,
  parseIntervalo,
  normalizarHoraHHMM,
  normalizarHoraDesdeTurno,
  conflictoSesionConOtrasEnPlan,
  consultarOcupacionHora,
  listarHorasLibresAgendaDia,
  // Compatibilidad anterior
  obtenerDiasBloqueados,
  estaFechaBloqueada
};

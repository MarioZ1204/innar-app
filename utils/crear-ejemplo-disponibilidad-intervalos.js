/**
 * Script para crear un archivo Excel de ejemplo con formato COMBINADO
 * Estructura: FECHA | MAÑANA | TARDE | INTERVALO (opcional) | RAZÓN (opcional)
 * 
 * Uso: node utils/crear-ejemplo-disponibilidad-intervalos.js
 */

const XLSX = require('xlsx');
const path = require('path');

// Crear un workbook
const wb = XLSX.utils.book_new();

// Crear datos de ejemplo - Sistema COMBINADO
const datos = [
  {
    'FECHA': '2026-02-23',
    'MAÑANA': 'SÍ',
    'TARDE': 'NO',
    'INTERVALO': '',
    'RAZÓN': ''
  },
  {
    'FECHA': '2026-02-24',
    'MAÑANA': 'SÍ',
    'TARDE': 'SÍ',
    'INTERVALO': '10:00-11:30',
    'RAZÓN': 'Capacitación médica'
  },
  {
    'FECHA': '2026-02-25',
    'MAÑANA': 'NO',
    'TARDE': 'NO',
    'INTERVALO': '',
    'RAZÓN': ''
  },
  {
    'FECHA': '2026-02-26',
    'MAÑANA': 'SÍ',
    'TARDE': 'SÍ',
    'INTERVALO': '07:00-09:00',
    'RAZÓN': 'Con estudiantes de la universidad'
  },
  {
    'FECHA': '2026-02-27',
    'MAÑANA': 'SÍ',
    'TARDE': 'SÍ',
    'INTERVALO': '15:00-16:00',
    'RAZÓN': 'Reunión administrativa'
  }
];

// Crear worksheet
const ws = XLSX.utils.json_to_sheet(datos);

// Ajustar ancho de columnas
ws['!cols'] = [
  { wch: 15 }, // FECHA
  { wch: 12 }, // MAÑANA
  { wch: 12 }, // TARDE
  { wch: 18 }, // INTERVALO
  { wch: 40 }  // RAZÓN
];

// Agregar worksheet al workbook
XLSX.utils.book_append_sheet(wb, ws, 'Disponibilidad');

// Guardar archivo
const filePath = path.join(__dirname, '..', 'public', 'ejemplos', 'disponibilidad-intervalos-ejemplo.xlsx');
XLSX.writeFile(wb, filePath);

console.log('✓ Archivo de ejemplo creado: ' + filePath);
console.log('\n📋 Formato COMBINADO esperado:');
console.log('\n1. COLUMNAS OBLIGATORIAS:');
console.log('   • FECHA: Formato YYYY-MM-DD o DD/MM/YYYY');
console.log('   • MAÑANA: SÍ/NO (define disponibilidad 7:00-12:00)');
console.log('   • TARDE: SÍ/NO (define disponibilidad 14:00-18:00)');
console.log('\n2. COLUMNAS OPCIONALES (para bloques específicos):');
console.log('   • INTERVALO: Formato HH:MM-HH:MM (ej: 07:00-09:00)');
console.log('   • RAZÓN: Texto descriptivo del bloqueo');
console.log('\n📌 Funcionamiento:');
console.log('   • MAÑANA/TARDE se valida PRIMERO (disponibilidad general)');
console.log('   • INTERVALO es un REFINAMIENTO (bloques dentro del turno disponible)');
console.log('   • Si MAÑANA=NO, no importa que INTERVALO tenga horas de mañana');
console.log('   • El INTERVALO solo puede estar DENTRO de un turno disponible');
console.log('\n✨ Ejemplos:');
console.log('   ✓ MAÑANA=SÍ, TARDE=NO, INTERVALO=07:00-09:00');
console.log('     → Bloqueado 07:00-09:00, disponible 09:00-12:00');
console.log('   ✗ MAÑANA=NO, TARDE=SÍ, INTERVALO=10:00-11:00');
console.log('     → ERROR: INTERVALO está en mañana pero MAÑANA=NO');

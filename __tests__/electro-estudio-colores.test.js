const {
  resolveEstudioElectroColor,
  registrarColoresCatalogo
} = require('../utils/electro-estudio-colores');

describe('electro-estudio-colores', () => {
  test('mismo nombre siempre mismo color', () => {
    const a = resolveEstudioElectroColor('PSG Básica');
    const b = resolveEstudioElectroColor('PSG Básica');
    expect(a).toEqual(b);
    expect(a.accent).toBe('#7c3aed');
  });

  test('PSG titulación distinto de PSG básica', () => {
    const basica = resolveEstudioElectroColor('PSG Básica');
    const cpap = resolveEstudioElectroColor('PSG con Titulación de Dispositivo Médico CPAP');
    expect(cpap.accent).not.toBe(basica.accent);
  });

  test('VTM azul, EEG amarillo', () => {
    const vtm = resolveEstudioElectroColor('Monitorización Electroencefalografica por Video y Radio');
    const eeg = resolveEstudioElectroColor('Electroencefalograma');
    expect(vtm.accent).toBe('#2563eb');
    expect(eeg.accent).toBe('#ca8a04');
  });

  test('catálogo registra colores estables', () => {
    const catalogo = ['PSG Básica', 'Electroencefalograma'];
    const map = registrarColoresCatalogo(catalogo);
    expect(map.get('PSG Básica').accent).toBe('#7c3aed');
    expect(map.get('Electroencefalograma').accent).toBe('#ca8a04');
  });
});

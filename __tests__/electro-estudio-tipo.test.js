const {
  tipoEstudioElectro,
  esEstudioElectroVtm,
  esEstudioElectroEeg
} = require('../utils/electro-estudio-tipo');
const { monitorEstudioColorKey } = require('../utils/electro-monitor');

describe('electro-estudio-tipo', () => {
  const VTM_NOMBRE = 'Monitorización Electroencefalografica por Video y Radio';
  const EEG_NOMBRE = 'Electroencefalograma';

  test('VTM no se clasifica como EEG', () => {
    expect(tipoEstudioElectro(VTM_NOMBRE)).toBe('vtm');
    expect(esEstudioElectroVtm(VTM_NOMBRE)).toBe(true);
    expect(esEstudioElectroEeg(VTM_NOMBRE)).toBe(false);
    expect(monitorEstudioColorKey(VTM_NOMBRE)).toBe('vtm');
  });

  test('EEG convencional no se clasifica como VTM', () => {
    expect(tipoEstudioElectro(EEG_NOMBRE)).toBe('eeg');
    expect(esEstudioElectroVtm(EEG_NOMBRE)).toBe(false);
    expect(monitorEstudioColorKey(EEG_NOMBRE)).toBe('eeg');
  });

  test('abreviatura VTM en nombre', () => {
    expect(tipoEstudioElectro('Monitorización VTM')).toBe('vtm');
  });

  test('PSG básica', () => {
    expect(tipoEstudioElectro('PSG Básica')).toBe('psg');
  });
});

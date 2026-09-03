'use strict';

const path = require('path');
const {
  getArmadoUcqnPersonaDir,
  getArmadoAnexoDir
} = require('../utils/soportes-armado-modos');
const { esAncestroEnMapa, normalizarParentId } = require('../utils/soportes-armado-dias-tree');

describe('UCQN / Anexo move path (padre cambia ruta)', () => {
  test('cambiar padre inmediato cambia la carpeta en disco UCQN', () => {
    const periodo = '2026-08';
    const persona = 'Juan Pérez';
    const oldRel = getArmadoUcqnPersonaDir(periodo, 'Mayo 1', persona);
    const newRel = getArmadoUcqnPersonaDir(periodo, 'Mayo 2', persona);
    expect(oldRel).not.toBe(newRel);
    expect(oldRel).toBe(path.join('armado', periodo, 'Mayo 1', persona).replace(/\\/g, '/'));
    expect(newRel).toBe(path.join('armado', periodo, 'Mayo 2', persona).replace(/\\/g, '/'));
  });

  test('anexo también depende del padre inmediato', () => {
    const oldRel = getArmadoAnexoDir('2026-08', 'Anexo FIDU', 'ANEXO 1');
    const newRel = getArmadoAnexoDir('2026-08', 'Grupo B', 'ANEXO 1');
    expect(oldRel).not.toBe(newRel);
  });

  test('normalizarParentId y ancestro evitan ciclos al mover', () => {
    expect(normalizarParentId(null)).toBe(0);
    expect(normalizarParentId('12')).toBe(12);
    const parentById = { 2: 1, 3: 2, 4: 1 };
    expect(esAncestroEnMapa(1, 3, parentById)).toBe(true);
    expect(esAncestroEnMapa(3, 1, parentById)).toBe(false);
    expect(esAncestroEnMapa(2, 4, parentById)).toBe(false);
  });
});

'use strict';

const path = require('path');
const {
  getArmadoUcqnPersonaDir,
  getArmadoAnexoDir
} = require('../utils/soportes-armado-modos');

describe('UCQN / Anexo disk paths (rename)', () => {
  test('persona UCQN bajo U C Q N usa armado/periodo/U C Q N/persona', () => {
    const rel = getArmadoUcqnPersonaDir('2026-08', 'U C Q N', 'Juan Pérez');
    expect(rel).toBe(path.join('armado', '2026-08', 'U C Q N', 'Juan Pérez').replace(/\\/g, '/'));
  });

  test('persona UCQN bajo carpeta intermedia usa el padre inmediato', () => {
    const rel = getArmadoUcqnPersonaDir('2026-08', 'Mayo 1', 'Ana López');
    expect(rel).toBe(path.join('armado', '2026-08', 'Mayo 1', 'Ana López').replace(/\\/g, '/'));
  });

  test('anexo usa la misma convención anidada', () => {
    const rel = getArmadoAnexoDir('2026-08', 'Anexo FIDU', 'ANEXO 1');
    expect(rel).toBe(path.join('armado', '2026-08', 'Anexo FIDU', 'ANEXO 1').replace(/\\/g, '/'));
  });
});

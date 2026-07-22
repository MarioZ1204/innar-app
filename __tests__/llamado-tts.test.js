const {
  textoAnuncioLlamado,
  consultorioParaVoz
} = require('../utils/llamado-tts');

describe('llamado-tts', () => {
  test('consultorioParaVoz lee dígitos uno a uno', () => {
    expect(consultorioParaVoz('302')).toBe('tres cero dos');
    expect(consultorioParaVoz('9')).toBe('nueve');
  });

  test('textoAnuncioLlamado incluye pausas naturales', () => {
    const t = textoAnuncioLlamado('Ana García', '302');
    expect(t).toContain('Atención');
    expect(t).toContain('Ana García');
    expect(t).toContain('tres cero dos');
  });
});

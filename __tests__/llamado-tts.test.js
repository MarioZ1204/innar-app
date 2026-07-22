const {
  textoAnuncioLlamado,
  consultorioParaVoz
} = require('../utils/llamado-tts');

describe('llamado-tts', () => {
  test('consultorioParaVoz conserva el número para lectura natural', () => {
    expect(consultorioParaVoz('302')).toBe('302');
    expect(consultorioParaVoz('9')).toBe('9');
    expect(consultorioParaVoz('')).toBe('indicado');
  });

  test('textoAnuncioLlamado es breve y conversacional', () => {
    const t = textoAnuncioLlamado('Ana García', '302');
    expect(t).toBe('Atención. Ana García, pase al consultorio 302.');
    expect(t).not.toContain('tres cero dos');
  });
});

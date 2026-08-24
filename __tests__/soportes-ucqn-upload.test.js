const { decodeUploadFilename, safeOriginalFilename } = require('../utils/soportes-archivo-detect');
const { ucqnDiskName } = require('../utils/soportes-ucqn-upload');

describe('decodeUploadFilename', () => {
  test('reconstruye García.pdf cuando multer lo leyó como latin1', () => {
    const mojibake = Buffer.from('García.pdf', 'utf8').toString('latin1');
    expect(mojibake).not.toBe('García.pdf');
    expect(decodeUploadFilename(mojibake)).toBe('García.pdf');
  });

  test('no altera un nombre ya correcto', () => {
    expect(decodeUploadFilename('García Pérez.pdf')).toBe('García Pérez.pdf');
  });

  test('normaliza NFD a NFC', () => {
    const nfd = 'García.pdf'.normalize('NFD');
    expect(decodeUploadFilename(nfd)).toBe('García.pdf');
  });

  test('conserva ASCII', () => {
    expect(decodeUploadFilename('informe.pdf')).toBe('informe.pdf');
  });
});

describe('ucqnDiskName', () => {
  test('conserva tildes y eñes', () => {
    expect(ucqnDiskName('García Muñoz.pdf')).toBe('García Muñoz.pdf');
  });

  test('decodifica mojibake y conserva tildes en disco', () => {
    const mojibake = Buffer.from('García.pdf', 'utf8').toString('latin1');
    expect(ucqnDiskName(mojibake)).toBe('García.pdf');
  });

  test('quita caracteres ilegales de ruta', () => {
    expect(ucqnDiskName('informe?.pdf')).toBe('informe_.pdf');
    expect(ucqnDiskName('foo<>bar.pdf')).toBe('foo__bar.pdf');
  });
});

describe('safeOriginalFilename', () => {
  test('conserva tildes', () => {
    expect(safeOriginalFilename('Niño.pdf')).toBe('Niño.pdf');
  });
});

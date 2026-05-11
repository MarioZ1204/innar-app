// __tests__/upload-magic-bytes.test.js
// Tests del validador de magic bytes (sin BD, sólo fs temporal).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateMagicBytes } = require('../middleware/upload');

function makeFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from(bytes));
  return file;
}

function runMw(filePath, originalname) {
  return new Promise((resolve) => {
    const req = { file: { path: filePath, originalname } };
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve({ status: this.statusCode, body: this.body, req }); }
    };
    validateMagicBytes(req, res, () => resolve({ status: 200, body: null, req }));
  });
}

describe('validateMagicBytes', () => {
  test('acepta PDF real', async () => {
    const f = makeFile('doc.pdf', [0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]);
    const r = await runMw(f, 'doc.pdf');
    expect(r.status).toBe(200);
    expect(r.req.file).not.toBeNull();
  });

  test('rechaza PDF con extensión engañosa (en realidad PNG)', async () => {
    const f = makeFile('fake.pdf', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const r = await runMw(f, 'fake.pdf');
    expect(r.status).toBe(400);
    expect(fs.existsSync(f)).toBe(false);
  });

  test('acepta PNG real', async () => {
    const f = makeFile('img.png', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const r = await runMw(f, 'img.png');
    expect(r.status).toBe(200);
  });

  test('acepta JPG real', async () => {
    const f = makeFile('img.jpg', [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const r = await runMw(f, 'img.jpg');
    expect(r.status).toBe(200);
  });

  test('acepta XLSX (firma ZIP PK\\x03\\x04)', async () => {
    const f = makeFile('hoja.xlsx', [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    const r = await runMw(f, 'hoja.xlsx');
    expect(r.status).toBe(200);
  });

  test('rechaza XLSX cuyo contenido no es ZIP', async () => {
    const f = makeFile('hoja.xlsx', [0xFF, 0xD8, 0xFF, 0xE0]);
    const r = await runMw(f, 'hoja.xlsx');
    expect(r.status).toBe(400);
  });

  test('CSV se acepta por extensión (sin magic)', async () => {
    const f = makeFile('datos.csv', [0x6E, 0x6F, 0x6D, 0x62, 0x72, 0x65, 0x2C, 0x65, 0x64, 0x61, 0x64]);
    const r = await runMw(f, 'datos.csv');
    expect(r.status).toBe(200);
  });
});

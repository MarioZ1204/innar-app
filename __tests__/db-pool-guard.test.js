// __tests__/db-pool-guard.test.js
// Verifica que el pool MySQL lanza error claro si no se ha inicializado.

const db = require('../utils/db-mysql');

describe('db-mysql guard', () => {
  test('query lanza si pool no inicializado', async () => {
    await expect(db.query('SELECT 1')).rejects.toThrow(/Pool no inicializado/);
  });

  test('execute lanza si pool no inicializado', async () => {
    await expect(db.execute('SELECT 1')).rejects.toThrow(/Pool no inicializado/);
  });

  test('transaction lanza si pool no inicializado', async () => {
    await expect(db.transaction(async () => {})).rejects.toThrow(/Pool no inicializado/);
  });
});

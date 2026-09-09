const { isDbConnectionError, isSqlError } = require('../utils/db-mysql');

describe('clasificación errores MySQL vs disco', () => {
  test('EPERM en puerto 3306 es error de conexión, no de disco', () => {
    const err = new Error('connect EPERM 127.0.0.1:3306 - Local (0.0.0.0:0)');
    err.code = 'EPERM';
    expect(isDbConnectionError(err)).toBe(true);
    expect(isSqlError(err)).toBe(false);
  });

  test('ER_NO_SUCH_TABLE es error SQL', () => {
    const err = new Error("Table 'x.y' doesn't exist");
    err.code = 'ER_NO_SUCH_TABLE';
    expect(isSqlError(err)).toBe(true);
    expect(isDbConnectionError(err)).toBe(false);
  });
});

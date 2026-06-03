const { insertRowId } = require('../utils/db-insert-id');

describe('insertRowId', () => {
  test('number insertId', () => {
    expect(insertRowId({ insertId: 42, affectedRows: 1 })).toBe(42);
  });

  test('bigint insertId', () => {
    expect(insertRowId({ insertId: BigInt(99), affectedRows: 1 })).toBe(99);
  });

  test('sin id', () => {
    expect(insertRowId({ affectedRows: 1 })).toBe(0);
    expect(insertRowId(null)).toBe(0);
  });
});

// __tests__/transactions.test.js
// Tests para utils/transactions.js usando mocks de db-mysql.

const mockConnection = {
  beginTransaction: jest.fn().mockResolvedValue(true),
  commit: jest.fn().mockResolvedValue(true),
  rollback: jest.fn().mockResolvedValue(true),
  release: jest.fn(),
  execute: jest.fn().mockResolvedValue([[{ id: 1, status: 'success' }], null])
};

const mockPool = {
  getConnection: jest.fn().mockResolvedValue(mockConnection)
};

jest.mock('../utils/db-mysql', () => ({
  getPool: () => mockPool,
  initPool: jest.fn(),
  query: jest.fn(),
  execute: jest.fn(),
  transaction: jest.fn()
}));

const transactions = require('../utils/transactions');

describe('Transactions System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection.execute.mockResolvedValue([[{ id: 1, status: 'success' }], null]);
  });

  describe('withTransaction', () => {
    test('start, execute and commit', async () => {
      const op = jest.fn().mockResolvedValue({ success: true });
      const result = await transactions.withTransaction(op, 'T');
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(op).toHaveBeenCalledWith(mockConnection);
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    test('rollback on error', async () => {
      const err = new Error('fail');
      const op = jest.fn().mockRejectedValue(err);
      await expect(transactions.withTransaction(op, 'T')).rejects.toBe(err);
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('release siempre', async () => {
      await transactions.withTransaction(jest.fn().mockResolvedValue('ok'));
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('executeTransaction', () => {
    test('ejecuta queries en orden y commit', async () => {
      const queries = [
        { sql: 'INSERT INTO t1 VALUES (?)', params: [1] },
        { sql: 'UPDATE t2 SET s = ?', params: ['c'] }
      ];
      const results = await transactions.executeTransaction(queries, 'multi');
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });

    test('rollback si una query falla', async () => {
      mockConnection.execute.mockRejectedValueOnce(new Error('Query failed'));
      await expect(transactions.executeTransaction([
        { sql: 'INSERT INTO t1 VALUES (?)', params: [1] }
      ])).rejects.toThrow('Query failed');
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });
  });

  describe('selectForUpdate', () => {
    test('agrega FOR UPDATE y delega a connection.execute', async () => {
      mockConnection.execute.mockResolvedValueOnce([[{ id: 1 }], null]);
      const rows = await transactions.selectForUpdate(mockConnection, 'SELECT * FROM t WHERE id = ?', [1]);
      expect(mockConnection.execute).toHaveBeenCalledWith('SELECT * FROM t WHERE id = ? FOR UPDATE', [1]);
      expect(rows).toEqual([{ id: 1 }]);
    });
  });
});

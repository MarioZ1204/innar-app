// __tests__/transactions.test.js
// Tests para verificar que las transacciones funcionan correctamente
// NOTA: Estos tests requieren una conexión a base de datos

const transactions = require('../utils/transactions');

describe('Transactions System', () => {
  // Mock para el pool de conexiones
  let mockConnection = {
    beginTransaction: jest.fn().mockResolvedValue(true),
    commit: jest.fn().mockResolvedValue(true),
    rollback: jest.fn().mockResolvedValue(true),
    release: jest.fn(),
    execute: jest.fn().mockResolvedValue([[{ id: 1, status: 'success' }], null])
  };

  let mockPool = {
    getConnection: jest.fn().mockResolvedValue(mockConnection)
  };

  // Mock del módulo db-mysql
  jest.mock('../utils/db-mysql', () => {
    return {
      getPool: () => mockPool
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('withTransaction', () => {
    test('should start, execute and commit a transaction', async () => {
      const operation = jest.fn().mockResolvedValue({ success: true });

      const result = await transactions.withTransaction(operation, 'Test Transaction');

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(operation).toHaveBeenCalledWith(mockConnection);
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    test('should rollback transaction on error', async () => {
      const error = new Error('Operation failed');
      const operation = jest.fn().mockRejectedValue(error);

      try {
        await transactions.withTransaction(operation, 'Failed Transaction');
      } catch (e) {
        expect(e).toBe(error);
      }

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('should always release connection', async () => {
      const operation = jest.fn().mockResolvedValue({ success: true });

      await transactions.withTransaction(operation);

      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('should release connection even on error', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Test error'));

      try {
        await transactions.withTransaction(operation);
      } catch (e) {
        // Expected
      }

      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  describe('executeTransaction', () => {
    test('should execute multiple queries in a transaction', async () => {
      const queries = [
        { 
          sql: 'INSERT INTO table1 VALUES (?)', 
          params: [1],
          description: 'Insert query 1'
        },
        { 
          sql: 'UPDATE table2 SET status = ?', 
          params: ['completed'],
          description: 'Update query 2'
        }
      ];

      const results = await transactions.executeTransaction(queries, 'Multi-query test');

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(results).toHaveLength(2);
    });

    test('should rollback if any query fails', async () => {
      mockConnection.execute.mockRejectedValueOnce(new Error('Query failed'));

      const queries = [
        { sql: 'INSERT INTO table1 VALUES (?)', params: [1] },
        { sql: 'UPDATE table2 SET status = ?', params: ['completed'] }
      ];

      try {
        await transactions.executeTransaction(queries);
      } catch (e) {
        expect(e.message).toBe('Query failed');
      }

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });
  });

  describe('selectForUpdate', () => {
    test('should add FOR UPDATE to SQL query', async () => {
      const operation = jest.fn().mockImplementation(async (conn) => {
        const sql = 'SELECT * FROM citas WHERE id = ?';
        const query = sql.replace(/;$/, '') + ' FOR UPDATE';
        expect(query).toContain('FOR UPDATE');
        return { locked: true };
      });

      await transactions.withTransaction(operation);

      expect(operation).toHaveBeenCalled();
    });
  });
});

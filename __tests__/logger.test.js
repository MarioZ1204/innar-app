// __tests__/logger.test.js
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

describe('Logger System', () => {
  const testLogDir = path.join(__dirname, '../logs');

  beforeEach(() => {
    // Limpiar archivos de log antes de cada test
    jest.clearAllMocks();
  });

  test('create logs directory if it does not exist', () => {
    logger.ensureLogDir();
    expect(fs.existsSync(testLogDir)).toBe(true);
  });

  test('info() should log message to app.log', () => {
    const spy = jest.spyOn(fs, 'appendFileSync');
    logger.info('Test info message', { key: 'value' });
    
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain('app.log');
    
    spy.mockRestore();
  });

  test('error() should log to both errors.log and app.log', () => {
    const spy = jest.spyOn(fs, 'appendFileSync');
    logger.error('Test error message', { code: 'ERR001' });
    
    expect(spy).toHaveBeenCalledTimes(2);
    
    spy.mockRestore();
  });

  test('warn() should log to app.log', () => {
    const spy = jest.spyOn(fs, 'appendFileSync');
    logger.warn('Test warning message');
    
    expect(spy).toHaveBeenCalled();
    
    spy.mockRestore();
  });

  test('success() should log success message', () => {
    const spy = jest.spyOn(fs, 'appendFileSync');
    logger.success('Operation successful', { duration: '250ms' });
    
    expect(spy).toHaveBeenCalled();
    
    spy.mockRestore();
  });

  test('api() should log HTTP request with method, path and status', () => {
    const spy = jest.spyOn(fs, 'appendFileSync');
    logger.api('GET', '/api/test', 200, 45);
    
    expect(spy).toHaveBeenCalled();
    
    spy.mockRestore();
  });

  test('debug() should only log when DEBUG_MODE is true', () => {
    process.env.DEBUG_MODE = 'true';
    const spy = jest.spyOn(fs, 'appendFileSync');
    
    logger.debug('Debug message', { detail: 'test' });
    expect(spy).toHaveBeenCalled();
    
    spy.mockRestore();
    process.env.DEBUG_MODE = 'false';
  });

  test('debug() should not log when DEBUG_MODE is false', () => {
    process.env.DEBUG_MODE = 'false';
    const spy = jest.spyOn(fs, 'appendFileSync');
    
    logger.debug('Debug message', { detail: 'test' });
    expect(spy).not.toHaveBeenCalled();
    
    spy.mockRestore();
  });

  test('getTail() should return recent log lines', () => {
    const appLogPath = path.join(testLogDir, 'app.log');
    
    // Crear archivo de prueba
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
    
    fs.writeFileSync(appLogPath, 'Line 1\nLine 2\nLine 3\n', 'utf8');
    
    const tail = logger.getTail(appLogPath, 2);
    expect(tail.length).toBeGreaterThan(0);
    expect(Array.isArray(tail)).toBe(true);
    
    // Limpiar
    if (fs.existsSync(appLogPath)) {
      fs.unlinkSync(appLogPath);
    }
  });
});

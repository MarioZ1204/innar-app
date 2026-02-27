// jest.setup.js
// Configurar variables de entorno para testing

process.env.NODE_ENV = 'test';
process.env.DEBUG_MODE = 'false';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '3306';
process.env.DB_USER = 'root';
process.env.DB_PASSWORD = '#1NN4R2026@*/';
process.env.DB_NAME = 'innar_clinica_test';
process.env.PORT = '3001';
process.env.USE_HTTPS = 'false';

// Suprimir logs durante testing
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

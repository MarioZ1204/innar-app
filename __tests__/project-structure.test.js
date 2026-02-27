// __tests__/project-structure.test.js
// Tests para verificar que la estructura del proyecto cumple con estándares

const fs = require('fs');
const path = require('path');

describe('Project Structure', () => {
  const projectRoot = path.join(__dirname, '..');

  test('should have required directories', () => {
    const requiredDirs = [
      'utils',
      'public',
      'logs',
      'docs',
      '__tests__'
    ];

    requiredDirs.forEach(dir => {
      const dirPath = path.join(projectRoot, dir);
      expect(fs.existsSync(dirPath)).toBe(true);
    });
  });

  test('should have required core files', () => {
    const requiredFiles = [
      'server.js',
      'package.json'
    ];

    requiredFiles.forEach(file => {
      const filePath = path.join(projectRoot, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  test('should have utils files for logging and transactions', () => {
    const utilsFiles = [
      'utils/logger.js',
      'utils/transactions.js',
      'utils/db-mysql.js'
    ];

    utilsFiles.forEach(file => {
      const filePath = path.join(projectRoot, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  test('should have documentation in docs folder', () => {
    const docsDir = path.join(projectRoot, 'docs');
    const docFiles = fs.readdirSync(docsDir);
    
    expect(docFiles.length).toBeGreaterThan(0);
    expect(docFiles.some(f => f.endsWith('.md'))).toBe(true);
  });

  test('package.json should have required scripts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    );

    expect(packageJson.scripts).toHaveProperty('start');
    expect(packageJson.scripts).toHaveProperty('test');
    expect(packageJson.scripts).toHaveProperty('dev');
  });

  test('package.json should have required dependencies', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    );

    const requiredDeps = [
      'express',
      'mysql2',
      'helmet',
      'bcrypt'
    ];

    requiredDeps.forEach(dep => {
      expect(packageJson.dependencies).toHaveProperty(dep);
    });
  });

  test('package.json should have Jest as devDependency', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    );

    expect(packageJson.devDependencies).toHaveProperty('jest');
  });

  test('should have jest configuration files', () => {
    const configFiles = [
      'jest.config.js',
      'jest.setup.js'
    ];

    configFiles.forEach(file => {
      const filePath = path.join(projectRoot, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});

describe('Logger Configuration', () => {
  test('logger.js should export required functions', () => {
    const logger = require('../utils/logger');

    const requiredFunctions = [
      'info',
      'error',
      'warn',
      'debug',
      'success',
      'api',
      'getTail',
      'ensureLogDir'
    ];

    requiredFunctions.forEach(func => {
      expect(typeof logger[func]).toBe('function');
    });
  });
});

describe('Transactions Configuration', () => {
  test('transactions.js should export required functions', () => {
    const transactions = require('../utils/transactions');

    const requiredFunctions = [
      'withTransaction',
      'executeTransaction',
      'selectForUpdate'
    ];

    requiredFunctions.forEach(func => {
      expect(typeof transactions[func]).toBe('function');
    });
  });
});

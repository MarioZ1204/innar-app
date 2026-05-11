module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'utils/**/*.js',
    'modules/**/*.js',
    'middleware/**/*.js',
    'services/**/*.js',
    'config/**/*.js',
    'routes/**/*.js',
    'migrations/**/*.js',
    '!**/*.test.js',
    '!node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 25,
      functions: 30,
      lines: 35,
      statements: 35
    }
  },
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000,
  verbose: true
};

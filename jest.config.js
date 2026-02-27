module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'utils/**/*.js',
    'modules/**/*.js',
    '!node_modules/**'
  ],
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 10000,
  verbose: true
};

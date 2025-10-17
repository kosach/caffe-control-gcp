module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/api', '<rootDir>/utils'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'api/**/*.ts',
    'utils/**/*.ts',
    '!**/*.test.ts',
    '!**/node_modules/**'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true
};

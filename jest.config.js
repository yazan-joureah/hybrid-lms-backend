module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/config/database.js',
    '!src/config/redis.js',
  ],
  transformIgnorePatterns: [
    // This tells Jest: "Ignore everything in node_modules EXCEPT otplib, @otplib, and @scure"
    '/node_modules/(?!(@scure|otplib|@otplib|@noble)/)',
  ],
  setupFiles: ['<rootDir>/tests/setup/disableRealGmail.js'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
  verbose: true,
  testTimeout: 15000,
};

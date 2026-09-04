// tests/unit/logger.test.js
describe('logger.js — level حسب NODE_ENV', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    jest.resetModules();
  });

  it('يستخدم level=info في بيئة production', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    // eslint-disable-next-line global-require
    const logger = require('../../src/utils/logger');
    expect(logger.level).toBe('info');
  });

  it('يستخدم level=debug في أي بيئة أخرى (development/test)', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line global-require
    const logger = require('../../src/utils/logger');
    expect(logger.level).toBe('debug');
  });
});

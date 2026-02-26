import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../utils/logger';

describe('Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('should create a logger with the given context', () => {
    const logger = createLogger('TEST');
    expect(logger).toBeDefined();
  });

  it('should log info messages when level is INFO', () => {
    process.env.LOG_LEVEL = 'INFO';
    const logger = createLogger('TEST');
    logger.info('test message');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[INFO] [TEST]'), 'test message');
  });

  it('should not log debug messages when level is INFO', () => {
    process.env.LOG_LEVEL = 'INFO';
    const logger = createLogger('TEST');
    logger.debug('debug message');
    expect(console.debug).not.toHaveBeenCalled();
  });

  it('should log debug messages when level is DEBUG', () => {
    process.env.LOG_LEVEL = 'DEBUG';
    const logger = createLogger('TEST');
    logger.debug('debug message');
    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('[DEBUG] [TEST]'), 'debug message');
  });

  it('should log warn messages', () => {
    process.env.LOG_LEVEL = 'INFO';
    const logger = createLogger('TEST');
    logger.warn('warn message');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[WARN] [TEST]'), 'warn message');
  });

  it('should log error messages', () => {
    process.env.LOG_LEVEL = 'INFO';
    const logger = createLogger('TEST');
    logger.error('error message');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ERROR] [TEST]'), 'error message');
  });
});

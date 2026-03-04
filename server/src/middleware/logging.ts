import pino from 'pino';

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: ['mnemonic', 'secretKey', 'privateKey', 'boc'],
      censor: '[REDACTED]',
    },
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;

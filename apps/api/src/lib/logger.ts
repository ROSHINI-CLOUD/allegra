import pino, { type Logger } from 'pino';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]'
] as const;

export function createLogger(enabled: boolean): Logger {
  return pino({
    enabled,
    level: enabled ? 'info' : 'silent',
    redact: {
      paths: [...REDACTED_PATHS],
      censor: '[redacted]'
    }
  });
}

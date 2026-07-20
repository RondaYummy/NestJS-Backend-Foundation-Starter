import type { LoggerOptions } from 'pino';

const PRETTY_TRANSPORT_OPTIONS = {
  colorize: true,
  translateTime: 'SYS:standard',
  ignore: 'pid,hostname',
} as const;

/**
 * Pure helper for AppLogger pino root options.
 * Pretty transport is only attached when `pretty` is true (NODE_ENV=development).
 */
export function buildPinoRootOptions(level: string, pretty: boolean): LoggerOptions {
  if (!pretty) {
    return { level };
  }

  return {
    level,
    transport: {
      target: 'pino-pretty',
      options: { ...PRETTY_TRANSPORT_OPTIONS },
    },
  };
}

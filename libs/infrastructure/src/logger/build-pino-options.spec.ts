/// <reference types="jest" />

import { buildPinoRootOptions } from './build-pino-options';

describe('buildPinoRootOptions', () => {
  it('returns level-only options without transport when pretty is false', () => {
    const options = buildPinoRootOptions('info', false);

    expect(options).toEqual({ level: 'info' });
    expect(options).not.toHaveProperty('transport');
  });

  it('attaches pino-pretty transport with frozen options when pretty is true', () => {
    const options = buildPinoRootOptions('debug', true);

    expect(options.level).toBe('debug');
    expect(options.transport).toEqual({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    });
  });

  it('preserves the provided level for both branches', () => {
    expect(buildPinoRootOptions('warn', false).level).toBe('warn');
    expect(buildPinoRootOptions('error', true).level).toBe('error');
  });
});

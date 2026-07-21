/// <reference types="jest" />

import { Writable } from 'node:stream';

import pino from 'pino';

import type { AppConfigService } from '../config/app-config.service';
import { AppLogger } from './app-logger.service';
import { buildPinoRootOptions } from './build-pino-options';
import type { RequestContextService } from './request-context.service';

describe('AppLogger', () => {
  it('constructs with JSON options and merges request context (pretty: false)', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });

    const config = {
      logger: () => ({ level: 'info', pretty: false }),
    } as unknown as AppConfigService;

    const requestContext = {
      get: () => ({ requestId: 'req-1' }),
    } as unknown as RequestContextService;

    const logger = new AppLogger(config, requestContext);
    // Replace internal pino instance with a destination-backed logger using the same options helper.
    (logger as unknown as { logger: pino.Logger }).logger = pino(
      buildPinoRootOptions('info', false),
      destination,
    );

    logger.info('hello', { userId: 'u-1' });

    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.msg).toBe('hello');
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.userId).toBe('u-1');
  });

  it('maps Nest string context to nestContext instead of spreading characters', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });

    const config = {
      logger: () => ({ level: 'info', pretty: false }),
    } as unknown as AppConfigService;

    const requestContext = {
      get: () => ({}),
    } as unknown as RequestContextService;

    const logger = new AppLogger(config, requestContext);
    (logger as unknown as { logger: pino.Logger }).logger = pino(
      buildPinoRootOptions('info', false),
      destination,
    );

    logger.warn('route warning', 'LegacyRouteConverter');

    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.msg).toBe('route warning');
    expect(parsed.nestContext).toBe('LegacyRouteConverter');
    expect(parsed['0']).toBeUndefined();
  });

  it('respects LOGGER_LEVEL filtering under pretty: false', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });

    const config = {
      logger: () => ({ level: 'info', pretty: false }),
    } as unknown as AppConfigService;

    const requestContext = {
      get: () => ({}),
    } as unknown as RequestContextService;

    const logger = new AppLogger(config, requestContext);
    (logger as unknown as { logger: pino.Logger }).logger = pino(
      buildPinoRootOptions('info', false),
      destination,
    );

    logger.debug('hidden');
    logger.info('visible');

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).msg).toBe('visible');
  });
});

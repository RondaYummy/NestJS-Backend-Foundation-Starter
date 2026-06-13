import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';

import { AppConfigService } from '../config/app-config.service';
import { RequestContextService } from './request-context.service';

type LogContext = Record<string, unknown>;

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: PinoLogger;

  constructor(
    config: AppConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    this.logger = pino({
      level: config.logger().level,
    });
  }

  log(message: unknown, context?: string): void {
    this.info(String(message), {
      nestContext: context,
    });
  }

  info(message: string, context: LogContext = {}): void {
    this.logger.info(this.buildContext(context), message);
  }

  debug(message: string, context: LogContext = {}): void {
    this.logger.debug(this.buildContext(context), message);
  }

  warn(message: string, context: LogContext = {}): void {
    this.logger.warn(this.buildContext(context), message);
  }

  error(message: string, errorOrTrace?: unknown, context?: string | LogContext): void {
    const normalizedContext =
      typeof context === 'string'
        ? {
            nestContext: context,
          }
        : (context ?? {});

    this.logger.error(
      this.buildContext({
        ...normalizedContext,
        error: this.normalizeError(errorOrTrace),
      }),
      message,
    );
  }

  verbose(message: unknown, context?: string): void {
    this.debug(String(message), {
      nestContext: context,
    });
  }

  fatal(message: string, context: LogContext = {}): void {
    this.logger.fatal(this.buildContext(context), message);
  }

  private buildContext(context: LogContext): LogContext {
    const requestContext = this.requestContext.get();

    return {
      ...requestContext,
      ...context,
    };
  }

  private normalizeError(error: unknown): unknown {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return error;
  }
}

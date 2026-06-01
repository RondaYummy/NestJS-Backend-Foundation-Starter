import { Injectable } from '@nestjs/common';
import pino, { type Logger } from 'pino';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class AppLogger {
  private readonly logger: Logger;
  constructor(config: AppConfigService) {
    const env = config.getString('app.env');
    this.logger = pino({
      level: config.getString('logger.level') || 'info',
      transport: env === 'development' ? { target: 'pino-pretty' } : undefined,
    });
  }
  debug(message: string, context?: object): void {
    this.logger.debug(context, message);
  }
  info(message: string, context?: object): void {
    this.logger.info(context, message);
  }
  warn(message: string, context?: object): void {
    this.logger.warn(context, message);
  }
  error(message: string, error?: unknown, context?: object): void {
    this.logger.error({ ...context, err: error }, message);
  }
}

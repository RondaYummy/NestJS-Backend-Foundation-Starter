import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  AppError,
  BusinessError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@domain/errors/domain-errors';
import { AppLogger } from '../logger/app-logger.service';
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = this.status(exception);
    if (!(exception instanceof AppError) && !(exception instanceof HttpException))
      this.logger.error('Unexpected error', exception);
    res.status(status).json({ success: false, error: this.error(exception) });
  }
  private status(e: unknown): number {
    if (e instanceof ValidationError) return HttpStatus.BAD_REQUEST;
    if (e instanceof NotFoundError) return HttpStatus.NOT_FOUND;
    if (e instanceof ConflictError) return HttpStatus.CONFLICT;
    if (e instanceof BusinessError) return HttpStatus.UNPROCESSABLE_ENTITY;
    if (e instanceof HttpException) return e.getStatus();
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
  private error(e: unknown): { code: string; message: string; details: Record<string, unknown> } {
    if (e instanceof AppError) return { code: e.code, message: e.message, details: e.details };
    if (e instanceof HttpException) return { code: 'HTTP_ERROR', message: e.message, details: {} };
    return { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', details: {} };
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  AppError,
  AuthenticationError,
  BusinessError,
  ConflictError,
  InvalidAuthRequestError,
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

  private status(error: unknown): number {
    if (error instanceof AuthenticationError) {
      return HttpStatus.UNAUTHORIZED;
    }

    if (error instanceof InvalidAuthRequestError) {
      return HttpStatus.BAD_REQUEST;
    }

    if (error instanceof ValidationError) {
      return HttpStatus.BAD_REQUEST;
    }

    if (error instanceof NotFoundError) {
      return HttpStatus.NOT_FOUND;
    }

    if (error instanceof ConflictError) {
      return HttpStatus.CONFLICT;
    }

    if (error instanceof BusinessError) {
      return HttpStatus.UNPROCESSABLE_ENTITY;
    }

    if (error instanceof HttpException) {
      return (error).getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private error(exception: unknown): {
    code: string;
    message: string | string[];
    details: Record<string, unknown>;
  } {
    if (exception instanceof AuthenticationError) {
      return {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof InvalidAuthRequestError) {
      return {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const response = (exception).getResponse();

      if (typeof response === 'string') {
        return {
          code: 'HTTP_ERROR',
          message: response,
          details: {},
        };
      }

      const body = response as Record<string, unknown>;

      const rawMessage = body.message;

      const message = Array.isArray(rawMessage)
        ? rawMessage.filter((item): item is string => typeof item === 'string')
        : typeof rawMessage === 'string'
          ? rawMessage
          : (exception).message;

      return {
        code:
          typeof body.error === 'string'
            ? body.error.toUpperCase().replaceAll(' ', '_')
            : 'HTTP_ERROR',
        message,
        details: {
          ...body,
          message: undefined,
          error: undefined,
          statusCode: undefined,
        },
      };
    }

    if (exception instanceof AppError) {
      return {
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      details: {},
    };
  }
}

/// <reference types="jest" />

import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { NotFoundError, ValidationError } from '@domain/errors/domain-errors';

import type { AppLogger } from '../logger/app-logger.service';
import { GlobalExceptionFilter } from './global-exception.filter';

function createHost(json: jest.Mock, status: jest.Mock): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: status.mockReturnValue({ json }),
      }),
    }),
  } as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  const logger = {
    error: jest.fn(),
  } as unknown as AppLogger;

  let filter: GlobalExceptionFilter;
  let json: jest.Mock;
  let status: jest.Mock;

  beforeEach(() => {
    filter = new GlobalExceptionFilter(logger);
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    jest.clearAllMocks();
  });

  it('maps ValidationError to 400 with domain error body', () => {
    filter.catch(
      new ValidationError('INVALID_EMAIL', 'Invalid email', { field: 'email' }),
      createHost(json, status),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INVALID_EMAIL',
        message: 'Invalid email',
        details: { field: 'email' },
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps NotFoundError to 404 with domain error body', () => {
    filter.catch(new NotFoundError('USER_NOT_FOUND', 'User not found'), createHost(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        details: {},
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps HttpException using status and response body', () => {
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), createHost(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'HTTP_ERROR',
        message: 'Forbidden',
        details: {},
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps unexpected Error to INTERNAL_SERVER_ERROR and logs via AppLogger', () => {
    const unexpected = new Error('boom');
    filter.catch(unexpected, createHost(json, status));

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        details: {},
      },
    });
    expect(logger.error).toHaveBeenCalledWith('Unexpected error', unexpected);
  });
});

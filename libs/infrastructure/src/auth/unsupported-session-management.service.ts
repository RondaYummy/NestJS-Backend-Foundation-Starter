import { Injectable } from '@nestjs/common';
import type {
  ISessionManagementService,
  RevokeOneResult,
  RevokeOthersResult,
  SessionListItem,
} from '@contracts/auth/session-management.service';
import { ValidationError } from '@domain/errors/domain-errors';

/**
 * JWT-driver stub: session-management routes stay registered (strategy B)
 * but every operation rejects with SESSION_DRIVER_REQUIRED → HTTP 400.
 */
@Injectable()
export class UnsupportedSessionManagementService implements ISessionManagementService {
  listForUser(_userId: string, _currentSessionId: string): Promise<SessionListItem[]> {
    return Promise.reject(this.driverError());
  }

  revokeOne(
    _userId: string,
    _sessionId: string,
    _currentSessionId: string,
  ): Promise<RevokeOneResult> {
    return Promise.reject(this.driverError());
  }

  revokeOthers(_userId: string, _currentSessionId: string): Promise<RevokeOthersResult> {
    return Promise.reject(this.driverError());
  }

  revokeAll(_userId: string): Promise<void> {
    return Promise.reject(this.driverError());
  }

  private driverError(): ValidationError {
    return new ValidationError(
      'SESSION_DRIVER_REQUIRED',
      'Session management is only available when AUTH_DRIVER=session',
    );
  }
}

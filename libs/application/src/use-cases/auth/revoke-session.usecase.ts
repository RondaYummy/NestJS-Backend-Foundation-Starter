import type { ISessionManagementService } from '@contracts/auth/session-management.service';

export class RevokeSessionUseCase {
  constructor(private readonly sessionManagement: ISessionManagementService) {}

  execute(userId: string, sessionId: string, currentSessionId: string) {
    return this.sessionManagement.revokeOne(userId, sessionId, currentSessionId);
  }
}

import type { ISessionManagementService } from '@contracts/auth/session-management.service';

export class RevokeOtherSessionsUseCase {
  constructor(private readonly sessionManagement: ISessionManagementService) {}

  execute(userId: string, currentSessionId: string) {
    return this.sessionManagement.revokeOthers(userId, currentSessionId);
  }
}

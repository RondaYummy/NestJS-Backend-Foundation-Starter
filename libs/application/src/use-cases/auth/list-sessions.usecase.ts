import type { ISessionManagementService } from '@contracts/auth/session-management.service';

export class ListSessionsUseCase {
  constructor(private readonly sessionManagement: ISessionManagementService) {}

  execute(userId: string, currentSessionId: string, currentAuthVersion: number) {
    return this.sessionManagement.listForUser(userId, currentSessionId, currentAuthVersion);
  }
}

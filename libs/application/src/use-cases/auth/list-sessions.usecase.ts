import type { ISessionManagementService } from '@contracts/auth/session-management.service';

export class ListSessionsUseCase {
  constructor(private readonly sessionManagement: ISessionManagementService) {}

  execute(userId: string, currentSessionId: string) {
    return this.sessionManagement.listForUser(userId, currentSessionId);
  }
}

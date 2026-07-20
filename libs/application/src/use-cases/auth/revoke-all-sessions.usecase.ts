import type { ISessionManagementService } from '@contracts/auth/session-management.service';

export class RevokeAllSessionsUseCase {
  constructor(private readonly sessionManagement: ISessionManagementService) {}

  execute(userId: string) {
    return this.sessionManagement.revokeAll(userId);
  }
}

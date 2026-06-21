import type { IAuthTokenService } from '@contracts/auth/auth-token.service';

export class RefreshAuthSessionUseCase {
  constructor(private readonly authTokenService: IAuthTokenService) {}

  execute(refreshToken: string) {
    return this.authTokenService.refreshAuthSession(refreshToken);
  }
}

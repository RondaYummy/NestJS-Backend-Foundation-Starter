import type { IAuthTokenService, RevokeAuthSessionInput } from '@contracts/auth/auth-token.service';

export class LogoutUseCase {
  constructor(private readonly authTokenService: IAuthTokenService) {}

  execute(input: RevokeAuthSessionInput): Promise<void> {
    return this.authTokenService.revoke(input);
  }
}

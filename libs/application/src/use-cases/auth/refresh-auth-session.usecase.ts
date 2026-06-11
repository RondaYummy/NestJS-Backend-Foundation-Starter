import { Inject, Injectable } from '@nestjs/common';

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { TOKENS } from '@contracts/tokens';

@Injectable()
export class RefreshAuthSessionUseCase {
  constructor(
    @Inject(TOKENS.AuthTokenService)
    private readonly authTokenService: IAuthTokenService,
  ) {}

  execute(refreshToken: string) {
    return this.authTokenService.refreshAuthSession(refreshToken);
  }
}

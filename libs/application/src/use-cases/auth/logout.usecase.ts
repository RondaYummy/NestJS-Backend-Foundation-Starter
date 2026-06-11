import { Inject, Injectable } from '@nestjs/common';

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { TOKENS } from '@contracts/tokens';

@Injectable()
export class LogoutUseCase {
  constructor(
    @Inject(TOKENS.AuthTokenService)
    private readonly authTokenService: IAuthTokenService,
  ) {}

  async execute(token: string): Promise<void> {
    await this.authTokenService.revoke(token);
  }
}

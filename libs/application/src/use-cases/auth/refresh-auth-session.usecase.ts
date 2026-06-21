import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { IAuthTokenService, ParsedRefreshToken } from '@contracts/auth/auth-token.service';
import type { CurrentUser } from '@contracts/auth/current-user';
import { AuthenticationError } from '@domain/errors/domain-errors';

export class RefreshAuthSessionUseCase {
  constructor(
    private readonly authTokenService: IAuthTokenService,
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(refreshToken: string) {
    const parsed = await this.authTokenService.parseRefreshToken(refreshToken);
    const freshUser = await this.loadFreshUser(parsed);

    return this.authTokenService.rotateAuthSession(parsed, freshUser);
  }

  private async loadFreshUser(parsed: ParsedRefreshToken): Promise<CurrentUser> {
    const user = await this.userRepository.findById(parsed.userId);

    if (!user) {
      throw new AuthenticationError('USER_NOT_FOUND', 'User not found');
    }

    if (user.authVersion !== parsed.authVersion) {
      throw new AuthenticationError(
        'AUTH_VERSION_MISMATCH',
        'Authorization credentials are stale',
      );
    }

    return {
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
      authVersion: user.authVersion,
    };
  }
}

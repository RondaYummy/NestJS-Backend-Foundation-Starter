import { createHash } from 'node:crypto';

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IPasswordResetTokenStore } from '@contracts/auth/password-reset-token-store';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import { ValidationError } from '@domain/errors/domain-errors';

type ResetPasswordInput = {
  token: string;
  newPassword: string;
};

export class ResetPasswordUseCase {
  constructor(
    private readonly passwordResetTokenStore: IPasswordResetTokenStore,
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly authTokenService: IAuthTokenService,
  ) {}

  async execute(input: ResetPasswordInput) {
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const userId = await this.passwordResetTokenStore.consume(tokenHash);

    if (!userId) {
      throw new ValidationError('INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new ValidationError('INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
    }

    const newPasswordHash = await this.passwordHasher.hash(input.newPassword);
    const updatedUser = user.changePassword(newPasswordHash);

    await this.userRepository.update(updatedUser);

    const auth = await this.authTokenService.createAuthSession({
      id: updatedUser.id,
      email: updatedUser.email.toString(),
      roles: updatedUser.roles,
      authVersion: updatedUser.authVersion,
    });

    return {
      user: {
        id: updatedUser.id,
        email: updatedUser.email.toString(),
        roles: updatedUser.roles,
      },
      auth,
    };
  }
}

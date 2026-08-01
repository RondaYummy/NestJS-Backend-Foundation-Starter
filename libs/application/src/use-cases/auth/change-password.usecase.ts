import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import { NotFoundError, ValidationError } from '@domain/errors/domain-errors';

type ChangePasswordInput = {
  userId: string;
  currentPassword: string;
  newPassword: string;
};

export class ChangePasswordUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly authTokenService: IAuthTokenService,
  ) {}

  async execute(input: ChangePasswordInput) {
    const user = await this.userRepository.findById(input.userId);

    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'User not found', { userId: input.userId });
    }

    // Google-only accounts have no current password to verify; reset-password
    // is the supported path to set an initial local password (TASK-004).
    if (user.passwordHash === null) {
      throw new ValidationError('PASSWORD_NOT_SET', 'No local password is set for this account');
    }

    const currentPasswordValid = await this.passwordHasher.compare(
      input.currentPassword,
      user.passwordHash,
    );

    if (!currentPasswordValid) {
      throw new ValidationError('INVALID_CURRENT_PASSWORD', 'Current password is invalid');
    }

    if (input.newPassword === input.currentPassword) {
      throw new ValidationError(
        'SAME_PASSWORD',
        'New password must differ from the current password',
      );
    }

    const newPasswordHash = await this.passwordHasher.hash(input.newPassword);
    const updatedUser = user.changePassword(newPasswordHash);

    await this.userRepository.update(updatedUser);

    // Purge stored sessions / refresh families before re-issuing, otherwise the
    // artifacts created below would be revoked too. The bumped authVersion stays
    // as defense in depth for credentials the store cannot reach.
    await this.authTokenService.revokeAllForUser(updatedUser.id);

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

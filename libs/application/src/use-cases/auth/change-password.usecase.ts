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

    // authVersion is already bumped, so prior JWT/session credentials fail
    // verification while the freshly issued session stays valid.
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

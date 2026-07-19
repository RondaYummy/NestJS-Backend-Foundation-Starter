import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { ValidationError } from '@domain/errors/domain-errors';
import { Email } from '@domain/value-objects/email.vo';

type LoginInput = {
  email: string;
  password: string;
};

export class LoginUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly authTokenService: IAuthTokenService,
  ) {}

  async execute(input: LoginInput) {
    const normalizedEmail = Email.create(input.email).toString();
    const user = await this.userRepository.findByEmail(normalizedEmail);

    if (!user) {
      throw new ValidationError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    // Google-only accounts have no local password; reject with the same code
    // as a wrong password to avoid revealing account provenance (FR-09/AC-05).
    if (user.passwordHash === null) {
      throw new ValidationError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const passwordValid = await this.passwordHasher.compare(input.password, user.passwordHash);

    if (!passwordValid) {
      throw new ValidationError('INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const auth = await this.authTokenService.createAuthSession({
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
      authVersion: user.authVersion,
    });

    return {
      user: {
        id: user.id,
        email: user.email.toString(),
        roles: user.roles,
      },
      auth,
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { IUserRepository } from '@contracts/repositories/user.repository';
import { TOKENS } from '@contracts/tokens';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { ValidationError } from '@domain/errors/domain-errors';

type LoginInput = {
  email: string;
  password: string;
};

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(TOKENS.UserRepository)
    private readonly userRepository: IUserRepository,

    @Inject(TOKENS.PasswordHasher)
    private readonly passwordHasher: IPasswordHasher,

    @Inject(TOKENS.AuthTokenService)
    private readonly authTokenService: IAuthTokenService,
  ) {}

  async execute(input: LoginInput) {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
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

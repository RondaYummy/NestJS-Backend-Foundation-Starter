import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import { IUserRepository } from '@contracts/repositories/user.repository';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';
import { TOKENS } from '@contracts/tokens';
import { User } from '@domain/entities/user.entity';
import { ConflictError } from '@domain/errors/domain-errors';
import { Inject, Injectable } from '@nestjs/common';


type RegisterInput = {
  email: string;
  password: string;
};

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(TOKENS.UserRepository)
    private readonly userRepository: IUserRepository,

    @Inject(TOKENS.PasswordHasher)
    private readonly passwordHasher: IPasswordHasher,

    @Inject(TOKENS.AuthTokenService)
    private readonly authTokenService: IAuthTokenService,

    @Inject(TOKENS.TransactionManager)
    private readonly transactionManager: ITransactionManager,
  ) {}

  async execute(input: RegisterInput) {
    const passwordHash = await this.passwordHasher.hash(input.password);

    const user = await this.transactionManager.run(async (trx) => {
      const existingUser = await this.userRepository.findByEmail(input.email, trx);

      if (existingUser) {
        throw new ConflictError('USER_ALREADY_EXISTS', 'User already exists');
      }

      const newUser = User.create({
        email: input.email,
        passwordHash,
        roles: ['user'],
      });

      await this.userRepository.save(newUser, trx);

      return newUser;
    });

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
import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import { IUserRepository } from '@contracts/repositories/user.repository';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';
import { TOKENS } from '@contracts/tokens';
import { User } from '@domain/entities/user.entity';
import { ConflictError } from '@domain/errors/domain-errors';
import { Inject, Injectable } from '@nestjs/common';
import { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { UserRegisteredEvent } from '@domain/events/user-registered.event';
import { Email } from '@domain/value-objects/email.vo';

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

    @Inject(TOKENS.OutboxWriter)
    private readonly outboxWriter: IOutboxWriter,
  ) {}

  async execute(input: RegisterInput) {
    const passwordHash = await this.passwordHasher.hash(input.password);
    const email = Email.create(input.email);

    const user = await this.transactionManager.run(async (trx) => {
      const newUser = User.create({
        email: email.toString(),
        passwordHash,
        roles: ['user'],
      });

      await this.userRepository.insert(newUser, trx);

      await this.outboxWriter.append(
        new UserRegisteredEvent({
          userId: newUser.id,
          email: newUser.email.toString(),
        }),
        trx,
      );

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

import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import { IUserRepository } from '@contracts/repositories/user.repository';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';
import { TOKENS } from '@contracts/tokens';
import { User } from '@domain/entities/user.entity';
import { ConflictError } from '@domain/errors/domain-errors';
import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_TEMPLATE } from '@contracts/mail/email-template-id';
import { QUEUES } from '@contracts/queues/queue-names';
import { IQueueGateway } from '@contracts/queues/queue-gateway';
import { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { UserRegisteredEvent } from '@domain/events/user-registered.event';

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

    @Inject(TOKENS.QueueGateway)
    private readonly queueGateway: IQueueGateway,

    @Inject(TOKENS.OutboxWriter)
    private readonly outboxWriter: IOutboxWriter,
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

    await this.queueGateway.add(QUEUES.EMAIL, 'send-welcome', {
      to: input.email,
      subject: 'Welcome',
      template: EMAIL_TEMPLATE.WELCOME,
      data: {
        email: user.email.toString(),
      },
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

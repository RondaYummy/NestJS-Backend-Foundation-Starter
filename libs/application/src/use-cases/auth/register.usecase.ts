import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';
import { User } from '@domain/entities/user.entity';
import { ConflictError } from '@domain/errors/domain-errors';
import type { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { UserRegisteredEvent } from '@domain/events/user-registered.event';
import { Email } from '@domain/value-objects/email.vo';
import { DuplicateRecordError } from '@contracts/repositories/repository-errors';

type RegisterInput = {
  email: string;
  password: string;
};

export class RegisterUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly transactionManager: ITransactionManager,
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

      try {
        await this.userRepository.insert(newUser, trx);
      } catch (error) {
        if (error instanceof DuplicateRecordError) {
          throw new ConflictError('USER_ALREADY_EXISTS', 'User already exists');
        }

        throw error;
      }

      await this.outboxWriter.append(
        new UserRegisteredEvent({
          userId: newUser.id,
          email: newUser.email.toString(),
        }),
        trx,
      );

      return newUser;
    });

    return {
      user: {
        id: user.id,
        email: user.email.toString(),
        roles: user.roles,
      },
    };
  }
}

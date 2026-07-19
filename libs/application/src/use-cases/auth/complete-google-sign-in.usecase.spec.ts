/// <reference types="jest" />

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { DuplicateRecordError } from '@contracts/repositories/repository-errors';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import type {
  ITransactionManager,
  TransactionContext,
} from '@contracts/transactions/transaction-manager';
import { TRANSACTION_CONTEXT } from '@contracts/transactions/transaction-manager';
import { User } from '@domain/entities/user.entity';
import { AuthenticationError, ConflictError } from '@domain/errors/domain-errors';
import { UserRegisteredEvent } from '@domain/events/user-registered.event';
import { Email } from '@domain/value-objects/email.vo';

import { CompleteGoogleSignInUseCase } from './complete-google-sign-in.usecase';

const fakeTrx = { [TRANSACTION_CONTEXT]: 'test' } as unknown as TransactionContext;

describe('CompleteGoogleSignInUseCase', () => {
  let userRepository: jest.Mocked<
    Pick<IUserRepository, 'findByGoogleSub' | 'findByEmail' | 'insert' | 'update'>
  >;
  let authTokenService: jest.Mocked<Pick<IAuthTokenService, 'createAuthSession'>>;
  let transactionManager: ITransactionManager;
  let outboxWriter: jest.Mocked<Pick<IOutboxWriter, 'append'>>;
  let useCase: CompleteGoogleSignInUseCase;

  const googleLinkedUser = () =>
    User.restore({
      id: 'user-sub',
      email: Email.create('linked@example.com'),
      passwordHash: null,
      googleSub: 'google-sub-1',
      roles: ['user'],
      authVersion: 2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

  const passwordUser = () =>
    User.restore({
      id: 'user-email',
      email: Email.create('existing@example.com'),
      passwordHash: 'bcrypt-hash',
      googleSub: null,
      roles: ['user'],
      authVersion: 5,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

  beforeEach(() => {
    userRepository = {
      findByGoogleSub: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    authTokenService = {
      createAuthSession: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
      }),
    };
    transactionManager = {
      run: jest.fn((handler: (trx: TransactionContext) => Promise<unknown>) => handler(fakeTrx)),
    } as unknown as ITransactionManager;
    outboxWriter = {
      append: jest.fn().mockResolvedValue(undefined),
    };
    useCase = new CompleteGoogleSignInUseCase(
      userRepository as unknown as IUserRepository,
      authTokenService as unknown as IAuthTokenService,
      transactionManager,
      outboxWriter,
    );
  });

  it('signs in an already-linked user by Google sub without touching email lookup (AC-03)', async () => {
    userRepository.findByGoogleSub.mockResolvedValue(googleLinkedUser());

    const result = await useCase.execute({
      sub: 'google-sub-1',
      email: 'linked@example.com',
      emailVerified: true,
    });

    expect(userRepository.findByGoogleSub).toHaveBeenCalledWith('google-sub-1');
    expect(userRepository.findByEmail).not.toHaveBeenCalled();
    expect(userRepository.insert).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
    expect(authTokenService.createAuthSession).toHaveBeenCalledWith({
      id: 'user-sub',
      email: 'linked@example.com',
      roles: ['user'],
      authVersion: 2,
    });
    expect(result.user).toEqual({ id: 'user-sub', email: 'linked@example.com', roles: ['user'] });
    expect(result.auth).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
  });

  it('resolves by sub even when the email is unverified (sub identity is durable)', async () => {
    userRepository.findByGoogleSub.mockResolvedValue(googleLinkedUser());

    await expect(
      useCase.execute({ sub: 'google-sub-1', email: 'linked@example.com', emailVerified: false }),
    ).resolves.toMatchObject({ user: { id: 'user-sub' } });
  });

  it('auto-links a verified Google email to the existing password user (AC-04)', async () => {
    userRepository.findByEmail.mockResolvedValue(passwordUser());

    const result = await useCase.execute({
      sub: 'google-sub-2',
      email: 'Existing@Example.com',
      emailVerified: true,
    });

    expect(userRepository.findByEmail).toHaveBeenCalledWith('existing@example.com');

    const linkedUser = userRepository.update.mock.calls[0]![0];
    expect(linkedUser.googleSub).toBe('google-sub-2');
    expect(linkedUser.id).toBe('user-email');
    expect(linkedUser.authVersion).toBe(5);

    expect(userRepository.insert).not.toHaveBeenCalled();
    expect(result.user.id).toBe('user-email');
    expect(authTokenService.createAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-email', authVersion: 5 }),
    );
  });

  it('rejects an unverified Google email with GOOGLE_SSO_EMAIL_UNVERIFIED and no side effects (AC-04)', async () => {
    userRepository.findByEmail.mockResolvedValue(passwordUser());

    const error: unknown = await useCase
      .execute({ sub: 'google-sub-2', email: 'existing@example.com', emailVerified: false })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).code).toBe('GOOGLE_SSO_EMAIL_UNVERIFIED');

    expect(userRepository.findByEmail).not.toHaveBeenCalled();
    expect(userRepository.update).not.toHaveBeenCalled();
    expect(userRepository.insert).not.toHaveBeenCalled();
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });

  it('creates a Google-only user with null password hash and outbox event on first sign-in (AC-03, FR-13)', async () => {
    const result = await useCase.execute({
      sub: 'google-sub-3',
      email: 'new-user@example.com',
      emailVerified: true,
    });

    const insertedUser = userRepository.insert.mock.calls[0]![0];
    expect(insertedUser.passwordHash).toBeNull();
    expect(insertedUser.googleSub).toBe('google-sub-3');
    expect(insertedUser.roles).toEqual(['user']);
    expect(userRepository.insert).toHaveBeenCalledWith(insertedUser, fakeTrx);

    const appendedEvent = outboxWriter.append.mock.calls[0]![0];
    expect(appendedEvent).toBeInstanceOf(UserRegisteredEvent);
    expect((appendedEvent as UserRegisteredEvent).payload).toEqual({
      userId: insertedUser.id,
      email: 'new-user@example.com',
    });
    expect(outboxWriter.append).toHaveBeenCalledWith(appendedEvent, fakeTrx);

    expect(result.user).toEqual({
      id: insertedUser.id,
      email: 'new-user@example.com',
      roles: ['user'],
    });
  });

  it('issues session-driver artifacts unchanged (AC-02 session shape)', async () => {
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    authTokenService.createAuthSession.mockResolvedValue({ sessionId: 'sess-1', expiresAt });
    userRepository.findByGoogleSub.mockResolvedValue(googleLinkedUser());

    const result = await useCase.execute({
      sub: 'google-sub-1',
      email: 'linked@example.com',
      emailVerified: true,
    });

    expect(result.auth).toEqual({ sessionId: 'sess-1', expiresAt });
  });

  it('maps a duplicate-record race during creation to USER_ALREADY_EXISTS', async () => {
    userRepository.insert.mockRejectedValue(new DuplicateRecordError('users_email_unique'));

    const error: unknown = await useCase
      .execute({ sub: 'google-sub-4', email: 'race@example.com', emailVerified: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('USER_ALREADY_EXISTS');
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });

  it('never exposes passwordHash or Google sub internals in the result', async () => {
    userRepository.findByEmail.mockResolvedValue(passwordUser());

    const result = await useCase.execute({
      sub: 'google-sub-2',
      email: 'existing@example.com',
      emailVerified: true,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('bcrypt-hash');
    expect(serialized).not.toContain('google-sub-2');
  });
});

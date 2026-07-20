/// <reference types="jest" />

import type { IAuthTokenService } from '@contracts/auth/auth-token.service';
import type { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IUserRepository } from '@contracts/repositories/user.repository';
import { User } from '@domain/entities/user.entity';
import { ValidationError } from '@domain/errors/domain-errors';
import { Email } from '@domain/value-objects/email.vo';

import { LoginUseCase } from './login.usecase';

describe('LoginUseCase', () => {
  let userRepository: jest.Mocked<Pick<IUserRepository, 'findByEmail'>>;
  let passwordHasher: jest.Mocked<Pick<IPasswordHasher, 'compare'>>;
  let authTokenService: jest.Mocked<Pick<IAuthTokenService, 'createAuthSession'>>;
  let useCase: LoginUseCase;

  const passwordUser = () =>
    User.restore({
      id: 'user-1',
      email: Email.create('user@example.com'),
      passwordHash: 'stored-hash',
      googleSub: null,
      roles: ['user'],
      authVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

  const googleOnlyUser = () =>
    User.restore({
      id: 'user-2',
      email: Email.create('google-only@example.com'),
      passwordHash: null,
      googleSub: 'google-sub-1',
      roles: ['user'],
      authVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

  beforeEach(() => {
    userRepository = {
      findByEmail: jest.fn().mockResolvedValue(passwordUser()),
    };
    passwordHasher = {
      compare: jest.fn().mockResolvedValue(true),
    };
    authTokenService = {
      createAuthSession: jest.fn().mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
      }),
    };
    useCase = new LoginUseCase(
      userRepository as unknown as IUserRepository,
      passwordHasher as unknown as IPasswordHasher,
      authTokenService as unknown as IAuthTokenService,
    );
  });

  it('authenticates a password user and issues auth artifacts', async () => {
    const result = await useCase.execute({
      email: 'user@example.com',
      password: 'secret',
      ip: '203.0.113.10',
      userAgent: 'TestAgent/1.0',
    });

    expect(passwordHasher.compare).toHaveBeenCalledWith('secret', 'stored-hash');
    expect(authTokenService.createAuthSession).toHaveBeenCalledWith(
      {
        id: 'user-1',
        email: 'user@example.com',
        roles: ['user'],
        authVersion: 1,
      },
      { ip: '203.0.113.10', userAgent: 'TestAgent/1.0' },
    );
    expect(result.user).toEqual({ id: 'user-1', email: 'user@example.com', roles: ['user'] });
  });

  it('forwards null client meta when ip and userAgent are omitted', async () => {
    await useCase.execute({ email: 'user@example.com', password: 'secret' });

    expect(authTokenService.createAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      { ip: null, userAgent: null },
    );
  });

  it('rejects an unknown email with INVALID_CREDENTIALS', async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    const error: unknown = await useCase
      .execute({ email: 'missing@example.com', password: 'secret' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    passwordHasher.compare.mockResolvedValue(false);

    const error: unknown = await useCase
      .execute({ email: 'user@example.com', password: 'wrong' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('INVALID_CREDENTIALS');
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });

  it('rejects a Google-only account (null password hash) with INVALID_CREDENTIALS without bcrypt compare (AC-05)', async () => {
    userRepository.findByEmail.mockResolvedValue(googleOnlyUser());

    const error: unknown = await useCase
      .execute({ email: 'google-only@example.com', password: 'anything' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).code).toBe('INVALID_CREDENTIALS');

    expect(passwordHasher.compare).not.toHaveBeenCalled();
    expect(authTokenService.createAuthSession).not.toHaveBeenCalled();
  });
});

import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';

import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
import { LogoutUseCase } from '@application/use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from '@application/use-cases/auth/refresh-auth-session.usecase';
import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';
import { ChangePasswordUseCase } from '@application/use-cases/auth/change-password.usecase';
import { ForgotPasswordUseCase } from '@application/use-cases/auth/forgot-password.usecase';
import { ResetPasswordUseCase } from '@application/use-cases/auth/reset-password.usecase';

import type { CurrentUser } from '@contracts/auth/current-user';
import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import type { IPasswordResetTokenStore } from '@contracts/auth/password-reset-token-store';
import { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import type { IQueueGateway } from '@contracts/queues/queue-gateway';
import { IUserRepository } from '@contracts/repositories/user.repository';
import { TOKENS } from '@contracts/tokens';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';

import { AuthModule } from '@infrastructure/auth/auth.module';
import { RedisPasswordResetTokenStore } from '@infrastructure/auth/redis-password-reset-token-store.service';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import { mapAppConfigToAuthOptions } from '@infrastructure/config/create-starter-kit-module-options';
import { AppLogger } from '@infrastructure/logger/app-logger.service';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { OutboxWriterModule } from '@infrastructure/outbox/outbox-writer.module';
import { RepositoriesModule } from '@infrastructure/repositories/repositories.module';
import { TransactionsModule } from '@infrastructure/transactions/transactions.module';

import { SessionCookieService } from '../auth/session-cookie.service';

type AuthApplicationCompositionModuleRegisterOptions = {
  redisModule: DynamicModule;
  drizzleModule: DynamicModule;
  /**
   * Module exporting `TOKENS.QueueGateway` (email queue) used by
   * `ForgotPasswordUseCase` to enqueue reset emails.
   */
  queuesModule: DynamicModule;
  imports?: ModuleMetadata['imports'];
};

const buildFreshUserResolver =
  (users: IUserRepository) =>
  async (userId: string): Promise<CurrentUser | null> => {
    const user = await users.findById(userId);

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email.toString(),
      roles: user.roles,
      authVersion: user.authVersion,
    };
  };

@Module({})
export class AuthApplicationCompositionModule {
  static register(options: AuthApplicationCompositionModuleRegisterOptions): DynamicModule {
    const { redisModule, drizzleModule } = options;

    const repositoriesModule = RepositoriesModule.register({
      imports: [drizzleModule],
    });

    const authModule = AuthModule.forRootAsync({
      imports: [InfrastructureConfigModule, redisModule, repositoriesModule],
      inject: [AppConfigService, TOKENS.UserRepository],
      useFactory: (config: AppConfigService, users: IUserRepository) => {
        const base = mapAppConfigToAuthOptions(config);
        const resolveFreshUser = buildFreshUserResolver(users);

        if (base.driver === 'session') {
          return {
            ...base,
            resolveSessionUser: resolveFreshUser,
          };
        }

        return {
          ...base,
          resolveAccessUser: resolveFreshUser,
        };
      },
    });

    return {
      module: AuthApplicationCompositionModule,
      imports: [
        ...(options.imports ?? []),
        InfrastructureConfigModule,
        LoggerModule,
        redisModule,
        drizzleModule,
        options.queuesModule,
        authModule,
        repositoriesModule,
        TransactionsModule.register({ imports: [drizzleModule] }),
        OutboxWriterModule.register({ imports: [drizzleModule] }),
      ],
      providers: [
        SessionCookieService,
        {
          provide: RegisterUseCase,
          inject: [
            TOKENS.UserRepository,
            TOKENS.PasswordHasher,
            TOKENS.TransactionManager,
            TOKENS.OutboxWriter,
          ],
          useFactory: (
            users: IUserRepository,
            passwords: IPasswordHasher,
            transactionManager: ITransactionManager,
            outboxWriter: IOutboxWriter,
          ) => new RegisterUseCase(users, passwords, transactionManager, outboxWriter),
        },
        {
          provide: LoginUseCase,
          inject: [TOKENS.UserRepository, TOKENS.PasswordHasher, TOKENS.AuthTokenService],
          useFactory: (
            users: IUserRepository,
            passwords: IPasswordHasher,
            authTokens: IAuthTokenService,
          ) => new LoginUseCase(users, passwords, authTokens),
        },
        {
          provide: LogoutUseCase,
          inject: [TOKENS.AuthTokenService],
          useFactory: (authTokens: IAuthTokenService) => new LogoutUseCase(authTokens),
        },
        {
          provide: RefreshAuthSessionUseCase,
          inject: [TOKENS.AuthTokenService, TOKENS.UserRepository],
          useFactory: (authTokens: IAuthTokenService, users: IUserRepository) =>
            new RefreshAuthSessionUseCase(authTokens, users),
        },
        {
          provide: GetCurrentUserUseCase,
          inject: [TOKENS.UserRepository],
          useFactory: (users: IUserRepository) => new GetCurrentUserUseCase(users),
        },
        RedisPasswordResetTokenStore,
        { provide: TOKENS.PasswordResetTokenStore, useExisting: RedisPasswordResetTokenStore },
        {
          provide: ChangePasswordUseCase,
          inject: [TOKENS.UserRepository, TOKENS.PasswordHasher, TOKENS.AuthTokenService],
          useFactory: (
            users: IUserRepository,
            passwords: IPasswordHasher,
            authTokens: IAuthTokenService,
          ) => new ChangePasswordUseCase(users, passwords, authTokens),
        },
        {
          provide: ForgotPasswordUseCase,
          inject: [
            TOKENS.UserRepository,
            TOKENS.PasswordResetTokenStore,
            TOKENS.QueueGateway,
            AppConfigService,
            AppLogger,
          ],
          useFactory: (
            users: IUserRepository,
            passwordResetTokens: IPasswordResetTokenStore,
            queueGateway: IQueueGateway,
            config: AppConfigService,
            logger: AppLogger,
          ) =>
            new ForgotPasswordUseCase(
              users,
              passwordResetTokens,
              queueGateway,
              {
                tokenTtlSeconds: config.passwordReset().tokenTtlSeconds,
                resetUrlBase: config.passwordReset().urlBase,
              },
              logger,
            ),
        },
        {
          provide: ResetPasswordUseCase,
          inject: [
            TOKENS.PasswordResetTokenStore,
            TOKENS.UserRepository,
            TOKENS.PasswordHasher,
            TOKENS.AuthTokenService,
          ],
          useFactory: (
            passwordResetTokens: IPasswordResetTokenStore,
            users: IUserRepository,
            passwords: IPasswordHasher,
            authTokens: IAuthTokenService,
          ) => new ResetPasswordUseCase(passwordResetTokens, users, passwords, authTokens),
        },
      ],
      exports: [
        authModule,
        SessionCookieService,
        RegisterUseCase,
        LoginUseCase,
        LogoutUseCase,
        RefreshAuthSessionUseCase,
        GetCurrentUserUseCase,
        ChangePasswordUseCase,
        ForgotPasswordUseCase,
        ResetPasswordUseCase,
      ],
    };
  }
}

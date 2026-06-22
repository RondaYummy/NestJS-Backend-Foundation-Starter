import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';

import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
import { LogoutUseCase } from '@application/use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from '@application/use-cases/auth/refresh-auth-session.usecase';
import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';

import type { CurrentUser } from '@contracts/auth/current-user';
import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { IUserRepository } from '@contracts/repositories/user.repository';
import { TOKENS } from '@contracts/tokens';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';

import { AuthModule } from '@infrastructure/auth/auth.module';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import { mapAppConfigToAuthOptions } from '@infrastructure/config/create-starter-kit-module-options';
import { OutboxWriterModule } from '@infrastructure/outbox/outbox-writer.module';
import { RepositoriesModule } from '@infrastructure/repositories/repositories.module';
import { TransactionsModule } from '@infrastructure/transactions/transactions.module';

import { SessionCookieService } from '../auth/session-cookie.service';

type AuthApplicationCompositionModuleRegisterOptions = {
  redisModule: DynamicModule;
  drizzleModule: DynamicModule;
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
        redisModule,
        drizzleModule,
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
      ],
      exports: [
        authModule,
        SessionCookieService,
        RegisterUseCase,
        LoginUseCase,
        LogoutUseCase,
        RefreshAuthSessionUseCase,
        GetCurrentUserUseCase,
      ],
    };
  }
}

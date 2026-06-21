import { Module } from '@nestjs/common';

import { RegisterUseCase } from '@application/use-cases/auth/register.usecase';
import { LoginUseCase } from '@application/use-cases/auth/login.usecase';
import { LogoutUseCase } from '@application/use-cases/auth/logout.usecase';
import { RefreshAuthSessionUseCase } from '@application/use-cases/auth/refresh-auth-session.usecase';
import { GetCurrentUserUseCase } from '@application/use-cases/auth/get-current-user.usecase';

import { IAuthTokenService } from '@contracts/auth/auth-token.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';
import { IOutboxWriter } from '@contracts/outbox/outbox-writer';
import { IUserRepository } from '@contracts/repositories/user.repository';
import { TOKENS } from '@contracts/tokens';
import type { ITransactionManager } from '@contracts/transactions/transaction-manager';

import { AuthModule } from '@infrastructure/auth/auth.module';
import { InfrastructureConfigModule } from '@infrastructure/config/infrastructure-config.module';
import { AppConfigService } from '@infrastructure/config/app-config.service';
import {
  mapAppConfigToAuthOptions,
  mapAppConfigToDrizzleOptions,
  mapAppConfigToRedisOptions,
} from '@infrastructure/config/create-starter-kit-module-options';
import { DrizzleModule } from '@infrastructure/database/drizzle/drizzle.module';
import { OutboxWriterModule } from '@infrastructure/outbox/outbox-writer.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { RepositoriesModule } from '@infrastructure/repositories/repositories.module';
import { TransactionsModule } from '@infrastructure/transactions/transactions.module';

import { SessionCookieService } from '../auth/session-cookie.service';

const redisModule = RedisModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToRedisOptions(config),
});

const drizzleModule = DrizzleModule.forRootAsync({
  imports: [InfrastructureConfigModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToDrizzleOptions(config),
});

const authModule = AuthModule.forRootAsync({
  imports: [InfrastructureConfigModule, redisModule],
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => mapAppConfigToAuthOptions(config),
});

@Module({
  imports: [
    InfrastructureConfigModule,
    redisModule,
    drizzleModule,
    authModule,
    RepositoriesModule.register({ imports: [drizzleModule] }),
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
      useFactory: (users: IUserRepository, passwords: IPasswordHasher, authTokens: IAuthTokenService) =>
        new LoginUseCase(users, passwords, authTokens),
    },
    {
      provide: LogoutUseCase,
      inject: [TOKENS.AuthTokenService],
      useFactory: (authTokens: IAuthTokenService) => new LogoutUseCase(authTokens),
    },
    {
      provide: RefreshAuthSessionUseCase,
      inject: [TOKENS.AuthTokenService],
      useFactory: (authTokens: IAuthTokenService) => new RefreshAuthSessionUseCase(authTokens),
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
})
export class AuthApplicationCompositionModule {}

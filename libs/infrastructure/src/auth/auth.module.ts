import {
  DynamicModule,
  Module,
  Provider,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { TOKENS } from '@contracts/tokens';

import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import { BcryptPasswordHasher } from './bcrypt-password-hasher.service';
import { JwtAuthTokenService } from './jwt-auth-token.service';
import { SessionAuthTokenService } from './session-auth-token.service';
import { RedisSessionStore } from './redis-session-store.service';
import { RedisJwtTokenStore } from './redis-jwt-token-store.service';
import {
  AUTH_MODULE_OPTIONS,
  isJwtAuthOptions,
  type AuthModuleOptions,
} from './auth.module-options';

type AuthModuleAsyncOptions = Pick<FactoryProvider<AuthModuleOptions>, 'useFactory' | 'inject'> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    const imports: ModuleMetadata['imports'] = [];

    if (isJwtAuthOptions(options)) {
      imports.push(JwtModule.register({ secret: options.jwt.secret }));
    }

    return {
      module: AuthModule,
      global: false,
      imports,
      providers: [
        { provide: AUTH_MODULE_OPTIONS, useValue: options },
        ...AuthModule.buildSharedProviders(),
        ...AuthModule.buildSyncDriverProviders(options),
      ],
      exports: AuthModule.buildExports(options),
    };
  }

  static forRootAsync(asyncOptions: AuthModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: AUTH_MODULE_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: AuthModule,
      global: false,
      imports: [
        ...(asyncOptions.imports ?? []),
        JwtModule.registerAsync({
          imports: asyncOptions.imports,
          inject: asyncOptions.inject,
          useFactory: async (...args: unknown[]) => {
            const authOptions = await asyncOptions.useFactory(...args);

            if (!isJwtAuthOptions(authOptions)) {
              return { secret: 'session-driver-jwt-placeholder' };
            }

            return { secret: authOptions.jwt.secret };
          },
        }),
      ],
      providers: [
        optionsProvider,
        ...AuthModule.buildSharedProviders(),
        ...AuthModule.buildAsyncDriverProviders(),
      ],
      exports: [TOKENS.PasswordHasher, TOKENS.AuthTokenService],
    };
  }

  /**
   * @deprecated Use `forRootAsync` at the composition root with typed options instead.
   */
  static forRootFromAppConfig(): DynamicModule {
    return AuthModule.forRootAsync({
      imports: [InfrastructureConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): AuthModuleOptions => {
        const auth = config.auth();

        if (auth.driver === 'session') {
          return {
            driver: 'session',
            passwordSaltRounds: auth.passwordSaltRounds,
            sessionTtlSeconds: auth.sessionTtlSeconds,
          };
        }

        return {
          driver: 'jwt',
          passwordSaltRounds: auth.passwordSaltRounds,
          jwt: config.jwt(),
        };
      },
    });
  }

  private static buildSharedProviders(): Provider[] {
    return [
      BcryptPasswordHasher,
      { provide: TOKENS.PasswordHasher, useExisting: BcryptPasswordHasher },
    ];
  }

  private static buildSyncDriverProviders(options: AuthModuleOptions): Provider[] {
    if (isJwtAuthOptions(options)) {
      return [
        RedisJwtTokenStore,
        JwtAuthTokenService,
        { provide: TOKENS.JwtTokenStore, useExisting: RedisJwtTokenStore },
        { provide: TOKENS.AuthTokenService, useExisting: JwtAuthTokenService },
      ];
    }

    return [
      RedisSessionStore,
      SessionAuthTokenService,
      { provide: TOKENS.SessionStore, useExisting: RedisSessionStore },
      { provide: TOKENS.AuthTokenService, useExisting: SessionAuthTokenService },
    ];
  }

  private static buildAsyncDriverProviders(): Provider[] {
    return [
      {
        provide: TOKENS.AuthTokenService,
        inject: [AUTH_MODULE_OPTIONS, JwtService, RedisService],
        useFactory: (options: AuthModuleOptions, jwtService: JwtService, redis: RedisService) => {
          if (isJwtAuthOptions(options)) {
            const tokenStore = new RedisJwtTokenStore(redis);
            return new JwtAuthTokenService(jwtService, options, tokenStore);
          }

          const sessionStore = new RedisSessionStore(redis);
          return new SessionAuthTokenService(sessionStore, options);
        },
      },
    ];
  }

  private static buildExports(options: AuthModuleOptions) {
    const base = [TOKENS.PasswordHasher, TOKENS.AuthTokenService];

    if (isJwtAuthOptions(options)) {
      return [...base, TOKENS.JwtTokenStore];
    }

    return [...base, TOKENS.SessionStore];
  }
}

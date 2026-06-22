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

export type AuthModuleRegistrationOptions = {
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
};

type AuthModuleAsyncOptions = Pick<FactoryProvider<AuthModuleOptions>, 'useFactory' | 'inject'> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class AuthModule {
  static forRoot(
    options: AuthModuleOptions,
    registration: AuthModuleRegistrationOptions = {},
  ): DynamicModule {
    AuthModule.assertSyncRegistration(options, registration);

    const imports: ModuleMetadata['imports'] = [...(registration.imports ?? [])];

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
        ...(registration.providers ?? []),
        ...AuthModule.buildSyncDriverProviders(options, registration),
      ],
      exports: AuthModule.buildExports(options),
    };
  }

  static forRootAsync(asyncOptions: AuthModuleAsyncOptions): DynamicModule {
    AuthModule.assertAsyncRegistration(asyncOptions);

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
            resolveSessionUser: () =>
              Promise.reject(
                new Error(
                  'Session user resolver must be wired at the composition root (AuthApplicationCompositionModule)',
                ),
              ),
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

  private static assertSyncRegistration(
    options: AuthModuleOptions,
    registration: AuthModuleRegistrationOptions,
  ): void {
    const hasImports = (registration.imports?.length ?? 0) > 0;

    if (isJwtAuthOptions(options)) {
      const hasCustomStore = AuthModule.hasCustomStoreProvider(
        registration.providers,
        TOKENS.JwtTokenStore,
      );

      if (!hasImports && !hasCustomStore) {
        throw new Error(
          'AuthModule.forRoot() requires RedisModule in registration.imports when using the default Redis-backed JWT token store. Pass { imports: [redisModule] } or supply a custom TOKENS.JwtTokenStore provider.',
        );
      }

      return;
    }

    const hasCustomStore = AuthModule.hasCustomStoreProvider(
      registration.providers,
      TOKENS.SessionStore,
    );

    if (!hasImports && !hasCustomStore) {
      throw new Error(
        'AuthModule.forRoot() requires RedisModule in registration.imports when using the default Redis-backed session store. Pass { imports: [redisModule] } or supply a custom TOKENS.SessionStore provider.',
      );
    }
  }

  private static assertAsyncRegistration(asyncOptions: AuthModuleAsyncOptions): void {
    if ((asyncOptions.imports?.length ?? 0) > 0) {
      return;
    }

    throw new Error(
      'AuthModule.forRootAsync() requires RedisModule in imports when using the default Redis-backed auth stores. Pass { imports: [redisModule] } alongside other required infrastructure modules.',
    );
  }

  private static hasCustomStoreProvider(providers: Provider[] | undefined, token: symbol): boolean {
    if (!providers?.length) {
      return false;
    }

    return providers.some(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === token,
    );
  }

  private static buildSyncDriverProviders(
    options: AuthModuleOptions,
    registration: AuthModuleRegistrationOptions,
  ): Provider[] {
    if (isJwtAuthOptions(options)) {
      const hasCustomStore = AuthModule.hasCustomStoreProvider(
        registration.providers,
        TOKENS.JwtTokenStore,
      );

      if (hasCustomStore) {
        return [
          JwtAuthTokenService,
          { provide: TOKENS.AuthTokenService, useExisting: JwtAuthTokenService },
        ];
      }

      return [
        RedisJwtTokenStore,
        JwtAuthTokenService,
        { provide: TOKENS.JwtTokenStore, useExisting: RedisJwtTokenStore },
        { provide: TOKENS.AuthTokenService, useExisting: JwtAuthTokenService },
      ];
    }

    const hasCustomStore = AuthModule.hasCustomStoreProvider(
      registration.providers,
      TOKENS.SessionStore,
    );

    if (hasCustomStore) {
      return [
        SessionAuthTokenService,
        { provide: TOKENS.AuthTokenService, useExisting: SessionAuthTokenService },
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

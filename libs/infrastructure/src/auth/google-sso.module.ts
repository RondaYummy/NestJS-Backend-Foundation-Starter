import {
  DynamicModule,
  Module,
  Provider,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';

import type { IGoogleIdentityService } from '@contracts/auth/google-identity.service';
import type { IGoogleOAuthStateStore } from '@contracts/auth/google-oauth-state.store';
import { TOKENS } from '@contracts/tokens';
import { ServiceUnavailableError } from '@domain/errors/domain-errors';

import { RedisService } from '../redis/redis.service';
import { GoogleOauthIdentityService } from './google-oauth-identity.service';
import { RedisGoogleOAuthStateStore } from './redis-google-oauth-state.store';
import {
  GOOGLE_SSO_MODULE_OPTIONS,
  isGoogleSsoEnabledOptions,
  type GoogleSsoModuleOptions,
} from './google-sso.module-options';

type GoogleSsoModuleAsyncOptions = Pick<
  FactoryProvider<GoogleSsoModuleOptions>,
  'useFactory' | 'inject'
> & {
  /** Must make `RedisService` resolvable (e.g. the composition Redis module). */
  imports?: ModuleMetadata['imports'];
};

const disabledError = (): ServiceUnavailableError =>
  new ServiceUnavailableError('GOOGLE_SSO_DISABLED', 'Google SSO is disabled');

/**
 * Stubs registered when Google SSO is disabled: routes short-circuit with 503
 * before reaching these, so any call indicates a wiring bug — fail loudly
 * without ever contacting Google (AC-07).
 */
const disabledIdentityService: IGoogleIdentityService = {
  createAuthorizationUrl: () => {
    throw disabledError();
  },
  exchangeAuthorizationCode: () => Promise.reject(disabledError()),
};

const disabledStateStore: IGoogleOAuthStateStore = {
  save: () => Promise.reject(disabledError()),
  consume: () => Promise.reject(disabledError()),
};

function createImplementationProviders(): Provider[] {
  return [
    {
      provide: TOKENS.GoogleIdentityService,
      inject: [GOOGLE_SSO_MODULE_OPTIONS],
      useFactory: (options: GoogleSsoModuleOptions): IGoogleIdentityService =>
        isGoogleSsoEnabledOptions(options)
          ? new GoogleOauthIdentityService(options)
          : disabledIdentityService,
    },
    {
      provide: TOKENS.GoogleOAuthStateStore,
      inject: [GOOGLE_SSO_MODULE_OPTIONS, RedisService],
      useFactory: (options: GoogleSsoModuleOptions, redis: RedisService): IGoogleOAuthStateStore =>
        isGoogleSsoEnabledOptions(options) ? new RedisGoogleOAuthStateStore(redis) : disabledStateStore,
    },
  ];
}

/**
 * Optional Google SSO module (Mail/Storage optional-driver pattern).
 * Disabled by default; when disabled, no Google credentials are required and
 * the registered port implementations refuse to contact Google.
 */
@Module({})
export class GoogleSsoModule {
  static forRoot(options: GoogleSsoModuleOptions, imports?: ModuleMetadata['imports']): DynamicModule {
    return {
      module: GoogleSsoModule,
      global: false,
      imports: imports ?? [],
      providers: [
        { provide: GOOGLE_SSO_MODULE_OPTIONS, useValue: options },
        ...createImplementationProviders(),
      ],
      exports: [GOOGLE_SSO_MODULE_OPTIONS, TOKENS.GoogleIdentityService, TOKENS.GoogleOAuthStateStore],
    };
  }

  static forRootAsync(asyncOptions: GoogleSsoModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: GOOGLE_SSO_MODULE_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: GoogleSsoModule,
      global: false,
      imports: asyncOptions.imports ?? [],
      providers: [optionsProvider, ...createImplementationProviders()],
      exports: [GOOGLE_SSO_MODULE_OPTIONS, TOKENS.GoogleIdentityService, TOKENS.GoogleOAuthStateStore],
    };
  }
}

import {
  DynamicModule,
  Module,
  Provider,
  type FactoryProvider,
  type ModuleMetadata,
} from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';

import { AppLogger } from '../logger/app-logger.service';
import { MailTemplateService } from './mail-template.service';
import { NullMailAdapter } from './null-mail.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';
import {
  MAIL_MODULE_OPTIONS,
  isSmtpMailOptions,
  type MailModuleOptions,
} from './mail.module-options';

type MailModuleAsyncOptions = Pick<FactoryProvider<MailModuleOptions>, 'useFactory' | 'inject'> & {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class MailModule {
  static forRoot(options: MailModuleOptions): DynamicModule {
    const gatewayProviders = isSmtpMailOptions(options)
      ? [SmtpMailAdapter, { provide: TOKENS.EmailGateway, useExisting: SmtpMailAdapter }]
      : [NullMailAdapter, { provide: TOKENS.EmailGateway, useExisting: NullMailAdapter }];

    return {
      module: MailModule,
      global: false,
      providers: [
        { provide: MAIL_MODULE_OPTIONS, useValue: options },
        MailTemplateService,
        ...gatewayProviders,
      ],
      exports: [TOKENS.EmailGateway, MailTemplateService],
    };
  }

  static forRootAsync(asyncOptions: MailModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: MAIL_MODULE_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: MailModule,
      global: false,
      imports: [...(asyncOptions.imports ?? [])],
      providers: [
        optionsProvider,
        MailTemplateService,
        {
          provide: TOKENS.EmailGateway,
          inject: [MAIL_MODULE_OPTIONS, AppLogger],
          useFactory: (options: MailModuleOptions, logger: AppLogger) =>
            isSmtpMailOptions(options) ? new SmtpMailAdapter(options) : new NullMailAdapter(logger),
        },
      ],
      exports: [TOKENS.EmailGateway, MailTemplateService],
    };
  }
}

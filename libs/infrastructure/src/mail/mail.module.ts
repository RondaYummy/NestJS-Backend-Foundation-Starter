import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { MailTemplateService } from './mail-template.service';
import { NullMailAdapter } from './null-mail.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';
import { LoggerModule } from '@infrastructure/logger/logger.module';

@Module({
  imports: [InfrastructureConfigModule, LoggerModule],
  providers: [
    MailTemplateService,
    NullMailAdapter,
    SmtpMailAdapter,
    {
      provide: TOKENS.EmailGateway,
      inject: [AppConfigService, NullMailAdapter, SmtpMailAdapter],
      useFactory: (config: AppConfigService, nullMail: NullMailAdapter, smtp: SmtpMailAdapter) =>
        config.mail().driver === 'smtp' ? smtp : nullMail,
    },
  ],
  exports: [TOKENS.EmailGateway, MailTemplateService],
})
export class MailModule {}

import { Module } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { InfrastructureConfigModule } from '../config/infrastructure-config.module';
import { AppConfigService } from '../config/app-config.service';
import { NullMailAdapter } from './null-mail.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';
@Module({
  imports: [InfrastructureConfigModule],
  providers: [
    NullMailAdapter,
    SmtpMailAdapter,
    {
      provide: TOKENS.EmailGateway,
      inject: [AppConfigService, NullMailAdapter, SmtpMailAdapter],
      useFactory: (config: AppConfigService, nullMail: NullMailAdapter, smtp: SmtpMailAdapter) =>
        config.getString('mail.driver') === 'smtp' ? smtp : nullMail,
    },
  ],
  exports: [TOKENS.EmailGateway],
})
export class MailModule {}

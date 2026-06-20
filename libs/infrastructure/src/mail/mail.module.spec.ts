/// <reference types="jest" />

import { Test } from '@nestjs/testing';

import { TOKENS } from '@contracts/tokens';
import { AppLogger } from '../logger/app-logger.service';
import { MailModule } from './mail.module';
import { NullMailAdapter } from './null-mail.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';

describe('MailModule', () => {
  it('registers only NullMailAdapter for null driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MailModule.forRoot({ driver: 'null' })],
    })
      .overrideProvider(AppLogger)
      .useValue({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() })
      .compile();

    expect(moduleRef.get(TOKENS.EmailGateway)).toBeInstanceOf(NullMailAdapter);
    expect(() => moduleRef.get(SmtpMailAdapter)).toThrow();

    await moduleRef.close();
  });

  it('registers only SmtpMailAdapter for smtp driver', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MailModule.forRoot({
          driver: 'smtp',
          smtp: {
            host: 'localhost',
            port: 1025,
            user: 'user',
            password: 'pass',
            from: 'test@example.com',
          },
        }),
      ],
    }).compile();

    expect(moduleRef.get(TOKENS.EmailGateway)).toBeInstanceOf(SmtpMailAdapter);
    expect(() => moduleRef.get(NullMailAdapter)).toThrow();

    await moduleRef.close();
  });
});

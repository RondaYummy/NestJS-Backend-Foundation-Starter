import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { AppConfigService } from '@infrastructure/config/app-config.service';

type SessionAuthResult = {
  sessionId?: string;
  expiresAt?: Date;
};

@Injectable()
export class SessionCookieService {
  constructor(private readonly config: AppConfigService) {}

  attachIfNeeded(response: Response, auth: SessionAuthResult): void {
    if (!auth.sessionId) {
      return;
    }

    response.cookie(this.config.auth().sessionCookieName, auth.sessionId, {
      ...this.getCookieOptions(),
      expires: auth.expiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(this.config.auth().sessionCookieName, this.getCookieOptions());
  }

  getSessionIdFromCookies(cookies: Record<string, unknown> | undefined): string | null {
    if (!cookies) {
      return null;
    }

    const sessionId = cookies[this.config.auth().sessionCookieName];

    return typeof sessionId === 'string' ? sessionId : null;
  }

  private getCookieOptions(): CookieOptions {
    const auth = this.config.auth();

    return {
      httpOnly: true,
      secure: this.config.app().env === 'production',
      sameSite: auth.sessionCookieSameSite,
      path: auth.sessionCookiePath,
      domain: auth.sessionCookieDomain || undefined,
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';

import { AUTH_MODULE_OPTIONS, type AuthModuleOptions } from './auth.module-options';

@Injectable()
export class BcryptPasswordHasher implements IPasswordHasher {
  constructor(
    @Inject(AUTH_MODULE_OPTIONS)
    private readonly options: AuthModuleOptions,
  ) {}

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.options.passwordSaltRounds);
  }

  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

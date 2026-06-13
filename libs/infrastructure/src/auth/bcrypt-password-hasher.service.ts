import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppConfigService } from '../config/app-config.service';
import { IPasswordHasher } from '@contracts/auth/password-hasher.service';

@Injectable()
export class BcryptPasswordHasher implements IPasswordHasher {
  constructor(private readonly config: AppConfigService) {}

  async hash(password: string): Promise<string> {
    const rounds = this.config.auth().passwordSaltRounds;
    return await bcrypt.hash(password, rounds);
  }

  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

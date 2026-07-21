import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { TOKENS } from '@contracts/tokens';
import { AuditLogger } from './audit.logger';

type AuditModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class AuditModule {
  static register(options: AuditModuleRegisterOptions = {}): DynamicModule {
    return {
      module: AuditModule,
      imports: [...(options.imports ?? [])],
      providers: [AuditLogger, { provide: TOKENS.AuditLogger, useExisting: AuditLogger }],
      exports: [TOKENS.AuditLogger],
    };
  }
}

import { DynamicModule, Module, type ModuleMetadata } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

type HealthModuleRegisterOptions = {
  imports?: ModuleMetadata['imports'];
};

@Module({})
export class HealthModule {
  static register(options: HealthModuleRegisterOptions = {}): DynamicModule {
    return {
      module: HealthModule,
      imports: options.imports ?? [],
      controllers: [HealthController],
      providers: [HealthService],
      exports: [HealthService],
    };
  }
}

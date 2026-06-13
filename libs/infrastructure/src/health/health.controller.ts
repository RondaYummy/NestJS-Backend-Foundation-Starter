import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async check(): Promise<unknown> {
    const result = await this.health.check();

    if (result.status === 'error') {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }

  @Get('live')
  live(): { status: 'ok' } {
    return {
      status: 'ok',
    };
  }

  @Get('ready')
  async ready(): Promise<unknown> {
    const result = await this.health.check();

    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }
}

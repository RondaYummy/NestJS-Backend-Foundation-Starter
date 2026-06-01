import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get() check(): Promise<unknown> {
    return this.health.check();
  }
  @Get('live') live(): { status: string } {
    return { status: 'ok' };
  }
  @Get('ready') ready(): Promise<unknown> {
    return this.health.check();
  }
}

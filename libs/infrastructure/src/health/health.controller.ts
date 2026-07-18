import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HealthService } from './health.service';
import { HealthResponseDto, LivenessResponseDto } from './health-response.dto';

const ERROR_ENVELOPE_SCHEMA = { $ref: '#/components/schemas/ErrorEnvelopeDto' };

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @ApiOperation({
    summary: 'Check aggregate service health',
    description:
      'Checks PostgreSQL, Redis, and BullMQ. Returns 503 when any dependency is unavailable.',
  })
  @ApiOkResponse({ description: 'All dependencies are healthy.', type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'One or more dependencies are unavailable.',
    schema: ERROR_ENVELOPE_SCHEMA,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    schema: ERROR_ENVELOPE_SCHEMA,
  })
  @Get()
  async check(): Promise<unknown> {
    const result = await this.health.check();

    if (result.status === 'error') {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }

  @ApiOperation({
    summary: 'Check process liveness',
    description: 'Does not probe external dependencies and is suitable for a liveness probe.',
  })
  @ApiOkResponse({ description: 'The API process is alive.', type: LivenessResponseDto })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    schema: ERROR_ENVELOPE_SCHEMA,
  })
  @Get('live')
  live(): { status: 'ok' } {
    return {
      status: 'ok',
    };
  }

  @ApiOperation({
    summary: 'Check service readiness',
    description: 'Checks PostgreSQL, Redis, and BullMQ before the instance receives traffic.',
  })
  @ApiOkResponse({ description: 'The API is ready.', type: HealthResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'The API is not ready because a dependency is unavailable.',
    schema: ERROR_ENVELOPE_SCHEMA,
  })
  @ApiInternalServerErrorResponse({
    description: 'Unexpected server error.',
    schema: ERROR_ENVELOPE_SCHEMA,
  })
  @Get('ready')
  async ready(): Promise<unknown> {
    const result = await this.health.check();

    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }

    return result;
  }
}

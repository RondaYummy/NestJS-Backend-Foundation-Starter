import { ApiProperty } from '@nestjs/swagger';

export class HealthServicesDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  postgres!: 'ok' | 'error';

  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  redis!: 'ok' | 'error';

  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  bullmq!: 'ok' | 'error';
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'error'], example: 'ok' })
  status!: 'ok' | 'error';

  @ApiProperty({ type: () => HealthServicesDto })
  services!: HealthServicesDto;
}

export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';
}

import { ApiProperty } from '@nestjs/swagger';

export class ErrorDto {
  @ApiProperty({ example: 'INVALID_CREDENTIALS' })
  code!: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Invalid credentials',
  })
  message!: string | string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {},
  })
  details!: Record<string, unknown>;
}

export class ErrorEnvelopeDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: () => ErrorDto })
  error!: ErrorDto;
}

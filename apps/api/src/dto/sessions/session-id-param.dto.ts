import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SessionIdParamDto {
  @ApiProperty({
    description: 'Session id (UUID v4 as issued by the session store).',
    format: 'uuid',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID('4')
  id!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionListItemDto {
  @ApiProperty({
    description: 'Session id.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({
    description: 'When the session was created (ISO-8601).',
    format: 'date-time',
    example: '2026-07-19T09:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description:
      'Last activity timestamp (ISO-8601). MVP equals createdAt until activity tracking is added.',
    format: 'date-time',
    example: '2026-07-19T09:00:00.000Z',
  })
  lastActivityAt!: string;

  @ApiProperty({
    description: 'When the Redis session key is expected to expire (ISO-8601).',
    format: 'date-time',
    example: '2026-07-26T09:00:00.000Z',
  })
  expiresAt!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Client IP captured at login, or null when unknown.',
    example: '203.0.113.10',
  })
  ip!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'User-Agent captured at login, or null when unknown.',
    example: 'Mozilla/5.0 ...',
  })
  userAgent!: string | null;

  @ApiProperty({
    description: 'True when this session is the one authenticating the current request.',
    example: true,
  })
  isCurrent!: boolean;
}

export class SessionsListDataDto {
  @ApiProperty({ type: () => [SessionListItemDto] })
  sessions!: SessionListItemDto[];
}

export class SessionsListResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: () => SessionsListDataDto })
  data!: SessionsListDataDto;
}

export class RevokeOthersDataDto {
  @ApiProperty({
    description: 'Number of sessions revoked (excluding the current session).',
    example: 2,
  })
  revokedCount!: number;
}

export class RevokeOthersResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: () => RevokeOthersDataDto })
  data!: RevokeOthersDataDto;
}

/** Revoke-one / revoke-all success envelope (logout-style). */
export class SessionMutationResponseDto {
  @ApiProperty({ example: true })
  success!: true;
}

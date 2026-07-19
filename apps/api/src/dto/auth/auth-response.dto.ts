import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty({ example: 'usr_01J8Y7V2VZ8Z4X6Y7K9M2N3P4Q' })
  id!: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email!: string;

  @ApiProperty({ type: [String], example: ['user'] })
  roles!: string[];
}

export class AuthTokensDto {
  @ApiPropertyOptional({
    description: 'JWT access token. Present only when AUTH_DRIVER=jwt.',
    example: '<access-token>',
  })
  accessToken?: string;

  @ApiPropertyOptional({
    description: 'Rotating JWT refresh token. Present only when AUTH_DRIVER=jwt.',
    example: '<refresh-token>',
  })
  refreshToken?: string;

  @ApiPropertyOptional({
    description:
      'Server-side session identifier. Present in response metadata when AUTH_DRIVER=session; clients authenticate with the httpOnly session cookie.',
    example: '<session-id>',
  })
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Session expiry timestamp. Present only when AUTH_DRIVER=session.',
    format: 'date-time',
    example: '2026-07-25T09:00:00.000Z',
  })
  expiresAt?: Date;
}

export class RegisterDataDto {
  @ApiProperty({ type: () => AuthUserDto })
  user!: AuthUserDto;
}

export class RegisterResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: () => RegisterDataDto })
  data!: RegisterDataDto;
}

export class LoginDataDto {
  @ApiProperty({ type: () => AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({ type: () => AuthTokensDto })
  auth!: AuthTokensDto;
}

export class LoginResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: () => LoginDataDto })
  data!: LoginDataDto;
}

export class RefreshResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: () => AuthTokensDto })
  data!: AuthTokensDto;
}

export class CurrentUserResponseDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ type: () => AuthUserDto })
  data!: AuthUserDto;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: true;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({
    example: true,
    description:
      'Always true. The response never reveals whether the email belongs to an account.',
  })
  success!: true;
}

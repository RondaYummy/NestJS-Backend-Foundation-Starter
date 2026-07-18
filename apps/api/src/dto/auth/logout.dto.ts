import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LogoutDto {
  /**
   * Обов’язковий для AUTH_DRIVER=jwt.
   * Не потрібен для AUTH_DRIVER=session.
   */
  @ApiPropertyOptional({
    description:
      'Required for AUTH_DRIVER=jwt to revoke the refresh-token family. Omit for AUTH_DRIVER=session, which uses the session cookie.',
    minLength: 1,
    example: '<current-refresh-token>',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

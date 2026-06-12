import { IsOptional, IsString, MinLength } from 'class-validator';

export class LogoutDto {
  /**
   * Обов’язковий для AUTH_DRIVER=jwt.
   * Не потрібен для AUTH_DRIVER=session.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

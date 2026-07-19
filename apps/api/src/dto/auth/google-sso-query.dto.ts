import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GoogleSsoStartQueryDto {
  @ApiPropertyOptional({
    description:
      'Absolute URL to redirect to after a successful session-cookie sign-in. Its origin must be listed in CORS_ORIGINS, otherwise the request fails with INVALID_RETURN_URL. Ignored for success delivery when AUTH_DRIVER=jwt (the callback returns the JSON login envelope instead; JWTs are never placed in URLs).',
    example: 'http://localhost:3000/auth/complete',
  })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}

/**
 * Google appends provider-specific query parameters (`scope`, `authuser`,
 * `prompt`, `hd`) to the callback redirect; they are accepted and ignored so
 * the global whitelist validation does not reject genuine Google callbacks.
 */
export class GoogleSsoCallbackQueryDto {
  @ApiPropertyOptional({ description: 'Authorization code issued by Google.' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Opaque CSRF state issued by the start endpoint.' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    description: 'OAuth error code from Google (e.g. access_denied) when the user cancels.',
  })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiPropertyOptional({ description: 'Granted scopes echoed by Google; ignored.' })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({ description: 'Google session index; ignored.' })
  @IsOptional()
  @IsString()
  authuser?: string;

  @ApiPropertyOptional({ description: 'Google consent prompt marker; ignored.' })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiPropertyOptional({ description: 'Google hosted domain echo; ignored.' })
  @IsOptional()
  @IsString()
  hd?: string;
}

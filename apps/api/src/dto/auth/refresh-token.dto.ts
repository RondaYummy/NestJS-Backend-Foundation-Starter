import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Current JWT refresh token. The token is rotated after a successful refresh.',
    minLength: 1,
    example: '<current-refresh-token>',
  })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

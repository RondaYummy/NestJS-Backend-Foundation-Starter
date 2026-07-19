import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: '<one-time-reset-token>',
    description: 'One-time reset token delivered by the password-reset email.',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ minLength: 8, example: 'NewStrongPassword123!' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

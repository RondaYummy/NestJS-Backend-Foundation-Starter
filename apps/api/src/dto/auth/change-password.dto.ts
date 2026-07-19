import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ minLength: 8, example: 'OldPassword123!' })
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @ApiProperty({
    minLength: 8,
    example: 'NewStrongPassword123!',
    description: 'Must differ from currentPassword.',
  })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

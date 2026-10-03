import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString() @IsNotEmpty()
  oldPassword: string;

  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  newPassword: string;
}

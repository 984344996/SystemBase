import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  password: string;
}

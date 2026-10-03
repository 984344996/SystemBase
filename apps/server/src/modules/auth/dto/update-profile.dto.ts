import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** 修改自己的基本资料（不含用户名与角色，这两项只能由管理员在用户管理里改） */
export class UpdateProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  name?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsEmail() @MaxLength(100)
  email?: string;
}

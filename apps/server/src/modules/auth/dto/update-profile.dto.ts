import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** 修改自己的基本资料（不含用户名与角色，这两项只能由管理员在用户管理里改） */
export class UpdateProfileDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50)
  name?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  /** 传空字符串表示清空（@IsOptional 只跳过 null/undefined，空串会被 @IsEmail 拒绝，故改用 ValidateIf） */
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '') @IsEmail() @MaxLength(100)
  email?: string;
}

import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Status } from '@sb/shared';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryUserDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string; // 用户名/姓名模糊

  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}

export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  password: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(100)
  email?: string;

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @IsOptional() @IsArray() @IsInt({ each: true }) @Type(() => Number)
  roleIds?: number[];
}

export class UpdateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(100)
  email?: string;

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @IsOptional() @IsArray() @IsInt({ each: true }) @Type(() => Number)
  roleIds?: number[];
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  newPassword: string;
}

import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Status } from '@sb/shared';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryUserDto extends PaginationDto {
  @ApiPropertyOptional({ description: '用户名/姓名模糊匹配' })
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}

export class CreateUserDto {
  @ApiProperty({ description: '登录用户名' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @ApiProperty({ description: '初始密码，至少 6 位' })
  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  password: string;

  @ApiProperty({ description: '姓名' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @ApiPropertyOptional({ type: [Number], description: '角色 id 列表' })
  @IsOptional() @IsArray() @IsInt({ each: true }) @Type(() => Number)
  roleIds?: number[];
}

export class UpdateUserDto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @ApiPropertyOptional({ type: [Number], description: '角色 id 列表' })
  @IsOptional() @IsArray() @IsInt({ each: true }) @Type(() => Number)
  roleIds?: number[];
}

export class ResetPasswordDto {
  @ApiProperty({ description: '新密码，至少 6 位' })
  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  newPassword: string;
}

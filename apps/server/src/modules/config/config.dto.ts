import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryConfigDto extends PaginationDto {
  @ApiPropertyOptional({ description: '按分组过滤' })
  @IsOptional() @IsString() @MaxLength(50)
  group?: string;

  @ApiPropertyOptional({ description: '键名/名称模糊匹配' })
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;
}

/**
 * 新增参数。没有 builtin 字段：「内置参数」只能由 seed 创建（不允许删除），
 * 不允许接口调用方把自己新增的参数标成内置、从而让它无法被删除
 */
export class CreateConfigDto {
  @ApiProperty({ description: '参数键，如 login.captcha' })
  @IsString() @MaxLength(100)
  key: string;

  // 与数据库列 VarChar(2000) 一致：超长在校验阶段就返回 400，而不是写库时报 500
  @ApiProperty({ maxLength: 2000 })
  @IsString() @MaxLength(2000)
  value: string;

  @ApiProperty({ enum: ['STRING', 'NUMBER', 'BOOL', 'JSON'] })
  @IsIn(['STRING', 'NUMBER', 'BOOL', 'JSON'])
  type: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(50)
  group?: string;

  @ApiProperty({ description: '展示名' })
  @IsString() @MaxLength(100)
  label: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

export class UpdateConfigDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
  value?: string;

  @ApiPropertyOptional({ enum: ['STRING', 'NUMBER', 'BOOL', 'JSON'] })
  @IsOptional() @IsIn(['STRING', 'NUMBER', 'BOOL', 'JSON'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(50)
  group?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

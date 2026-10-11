import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

export class CreateConfigDto {
  @ApiProperty({ description: '参数键，如 login.captcha' })
  @IsString() @MaxLength(100)
  key: string;

  @ApiProperty()
  @IsString()
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
  @IsOptional() @IsBoolean()
  builtin?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

export class UpdateConfigDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
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

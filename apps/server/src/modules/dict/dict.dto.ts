import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Status } from '@sb/shared';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryDictDto extends PaginationDto {
  @ApiPropertyOptional({ description: '编码/名称模糊匹配' })
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;
}

export class CreateDictDto {
  @ApiProperty({ description: '字典编码，如 user_status' })
  @IsString() @MaxLength(50)
  code: string;

  @ApiProperty()
  @IsString() @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

export class UpdateDictDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

export class CreateDictItemDto {
  @ApiProperty({ description: '展示文案' })
  @IsString() @MaxLength(100)
  label: string;

  @ApiProperty({ description: '存储值' })
  @IsString() @MaxLength(100)
  value: string;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sort?: number;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

export class UpdateDictItemDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  value?: string;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  sort?: number;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

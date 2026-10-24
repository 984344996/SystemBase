import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryNoticeDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['NOTICE', 'MSG'] })
  @IsOptional() @IsIn(['NOTICE', 'MSG'])
  type?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  keyword?: string;
}

export class CreateNoticeDto {
  @ApiProperty()
  @IsString() @MaxLength(200)
  title: string;

  @ApiProperty()
  @IsString()
  content: string;

  @ApiPropertyOptional({ enum: ['NOTICE', 'MSG'] })
  @IsOptional() @IsIn(['NOTICE', 'MSG'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  top?: boolean;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'])
  status?: string;

  @ApiPropertyOptional({ description: '生效开始时间（ISO 8601）' })
  @IsOptional() @IsISO8601({}, { message: 'startAt 需为 ISO 8601 时间' })
  startAt?: string;

  @ApiPropertyOptional({ description: '生效结束时间（ISO 8601）' })
  @IsOptional() @IsISO8601({}, { message: 'endAt 需为 ISO 8601 时间' })
  endAt?: string;
}

export class UpdateNoticeDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  content?: string;

  @ApiPropertyOptional({ enum: ['NOTICE', 'MSG'] })
  @IsOptional() @IsIn(['NOTICE', 'MSG'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  top?: boolean;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED'] })
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'])
  status?: string;

  @ApiPropertyOptional({ description: '生效开始时间（ISO 8601；传 null 清空）', nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsISO8601({}, { message: 'startAt 需为 ISO 8601 时间' })
  startAt?: string | null;

  @ApiPropertyOptional({ description: '生效结束时间（ISO 8601；传 null 清空）', nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsISO8601({}, { message: 'endAt 需为 ISO 8601 时间' })
  endAt?: string | null;
}

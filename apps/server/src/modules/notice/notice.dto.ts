import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

/** 时间必须带时区（Z 或 ±hh:mm）：不带时区的串会按服务器时区解析，部署地 / SB_TZ 一变含义就变 */
const WITH_TZ = /(Z|[+-]\d{2}:\d{2})$/;
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

  @ApiPropertyOptional({ description: '生效开始时间（ISO 8601，必须带时区，如 2026-11-22T00:00:00Z）' })
  @IsOptional() @IsISO8601({ strict: true }, { message: 'startAt 需为 ISO 8601 时间' }) @Matches(WITH_TZ, { message: 'startAt 需带时区，如 2026-11-22T08:00:00Z 或 +08:00' })
  startAt?: string;

  @ApiPropertyOptional({ description: '生效结束时间（ISO 8601，必须带时区）' })
  @IsOptional() @IsISO8601({ strict: true }, { message: 'endAt 需为 ISO 8601 时间' }) @Matches(WITH_TZ, { message: 'endAt 需带时区，如 2026-11-22T08:00:00Z 或 +08:00' })
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
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsISO8601({ strict: true }, { message: 'startAt 需为 ISO 8601 时间' }) @Matches(WITH_TZ, { message: 'startAt 需带时区，如 2026-11-22T08:00:00Z 或 +08:00' })
  startAt?: string | null;

  @ApiPropertyOptional({ description: '生效结束时间（ISO 8601；传 null 清空）', nullable: true })
  @ValidateIf((_, v) => v !== null && v !== undefined) @IsISO8601({ strict: true }, { message: 'endAt 需为 ISO 8601 时间' }) @Matches(WITH_TZ, { message: 'endAt 需带时区，如 2026-11-22T08:00:00Z 或 +08:00' })
  endAt?: string | null;
}

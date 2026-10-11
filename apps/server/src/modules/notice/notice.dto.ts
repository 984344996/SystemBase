import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

  @ApiPropertyOptional({ description: '生效开始时间（ISO 字符串）' })
  @IsOptional() @IsString()
  startAt?: string;

  @ApiPropertyOptional({ description: '生效结束时间（ISO 字符串）' })
  @IsOptional() @IsString()
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

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  startAt?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  endAt?: string;
}

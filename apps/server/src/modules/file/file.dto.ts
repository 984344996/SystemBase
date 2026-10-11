import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryFileDto extends PaginationDto {
  @ApiPropertyOptional({ description: '文件名模糊匹配' })
  @IsOptional() @IsString() @MaxLength(255)
  keyword?: string;
}

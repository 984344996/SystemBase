import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type PageResult } from '@sb/shared';

/** 列表接口通用分页参数：?page=1&pageSize=10&sort=createdAt:desc */
export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = DEFAULT_PAGE;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  /** 排序：字段:asc|desc，可逗号分隔多个 */
  @IsOptional() @IsString()
  sort?: string;
}

/** 分页响应结构（来自 @sb/shared，前后端同构） */
export type { PageResult };

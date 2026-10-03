export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 100;

/** 分页响应结构（前后端同构） */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

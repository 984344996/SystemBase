import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationDto } from '../../core/pagination/pagination.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MSG = { message: 'date 格式应为 YYYY-MM-DD' };

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export const LOG_CATEGORIES = ['app', 'access', 'audit', 'job'] as const;
/** 日志来源：server=后端 app.*.log / client=前端 web.*.log */
export const LOG_SOURCES = ['server', 'client'] as const;

/** 指定日期（缺省今天） */
export class LogDateDto {
  @IsOptional() @Matches(DATE_RE, DATE_MSG)
  date?: string;

  @IsOptional() @IsIn(LOG_SOURCES)
  source?: string;
}

/** 系统日志：按天文件检索 */
export class QueryLogDto extends PaginationDto {
  @IsOptional() @Matches(DATE_RE, DATE_MSG)
  date?: string;

  @IsOptional() @IsIn(LOG_LEVELS)
  level?: string;

  @IsOptional() @IsIn(LOG_CATEGORIES)
  category?: string;

  /** 前端日志（web.*.log）与后端日志分开存放，用 source 切换；查询前端日志时 level/category 过滤不适用 */
  @IsOptional() @IsIn(LOG_SOURCES)
  source?: string;

  @IsOptional() @IsString() @MaxLength(100)
  keyword?: string; // 原始行包含

  @IsOptional() @Matches(/^[a-zA-Z0-9-]{1,64}$/, { message: 'traceId 格式不正确' })
  traceId?: string;
}

/** 登录日志（audit / event=login） */
export class QueryLoginLogDto extends PaginationDto {
  @IsOptional() @Matches(DATE_RE, DATE_MSG)
  date?: string;

  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string; // 用户名包含

  /** query 串里布尔值用字符串传，避免 "false" 被隐式转换成 true */
  @IsOptional() @IsIn(['true', 'false'])
  success?: string;
}

/** 操作日志（audit / event=operate） */
export class QueryOperateLogDto extends PaginationDto {
  @IsOptional() @Matches(DATE_RE, DATE_MSG)
  date?: string;

  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string; // 用户名 / 模块 / 动作 包含

  @IsOptional() @IsString() @MaxLength(50)
  module?: string; // 精确模块名

  @IsOptional() @IsIn(['true', 'false'])
  success?: string;
}

import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsJSON,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class CreateJobDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  /** 必须是代码中已注册的 @JobHandler key */
  @IsString() @IsNotEmpty() @MaxLength(100)
  handlerKey: string;

  /** 5 段 cron: 分 时 日 月 周 */
  @IsString() @IsNotEmpty() @MaxLength(50)
  cronExpr: string;

  @IsOptional() @IsJSON()
  params?: string; // JSON 字符串，如 {"pageSize":100}

  @IsOptional() @IsIn(['SKIP', 'RUN_ONCE'])
  misfirePolicy?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(3600)
  timeoutSec?: number;

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

export class UpdateJobDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  name: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  cronExpr: string;

  @IsOptional() @IsJSON()
  params?: string;

  @IsOptional() @IsIn(['ENABLED', 'PAUSED'])
  status?: string;

  @IsOptional() @IsIn(['SKIP', 'RUN_ONCE'])
  misfirePolicy?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(3600)
  timeoutSec?: number;

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;
}

/** 执行记录查询：读当天(或指定日期)日志文件中 category=job event=run 的记录 */
export class QueryJobLogDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt()
  jobId?: number;

  @IsOptional() @IsIn(['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED_LOCK'])
  status?: string;

  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 格式应为 YYYY-MM-DD' })
  date?: string;
}

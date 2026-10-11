import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 前端上报的日志条目（字段都已限制长度，服务端还会二次截断） */
export class ClientLogDto {
  @ApiProperty({ description: '错误摘要' })
  @IsString() @MaxLength(1000)
  msg: string;

  @ApiPropertyOptional({ enum: ['info', 'warn', 'error'], description: '级别，默认 error' })
  @IsOptional() @IsIn(['info', 'warn', 'error'])
  level?: string;

  @ApiPropertyOptional({ description: '页面 URL（服务端会去掉 query 再保存）' })
  @IsOptional() @IsString() @MaxLength(500)
  url?: string;

  @ApiPropertyOptional({ description: '浏览器 userAgent' })
  @IsOptional() @IsString() @MaxLength(500)
  ua?: string;

  @ApiPropertyOptional({ description: '错误堆栈' })
  @IsOptional() @IsString() @MaxLength(4000)
  stack?: string;

  @ApiPropertyOptional({ description: '最近一次请求的 traceId，用于串联后端日志' })
  @IsOptional() @IsString() @MaxLength(64)
  traceId?: string;

  @ApiPropertyOptional({ description: '前端版本（发布号）' })
  @IsOptional() @IsString() @MaxLength(64)
  release?: string;

  @ApiPropertyOptional({ description: '来源类型：error / unhandledrejection / console / manual' })
  @IsOptional() @IsString() @MaxLength(32)
  kind?: string;
}

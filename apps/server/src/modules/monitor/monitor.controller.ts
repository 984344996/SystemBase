import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { basename } from 'node:path';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { MonitorService } from './monitor.service';
import { LogDateDto, QueryLogDto, QueryLoginLogDto, QueryOperateLogDto } from './monitor.dto';

/** 日志只读：保留期由 LOG_KEEP_DAYS 统一控制，不提供删除接口（防止抹除审计痕迹） */
@Controller('monitor')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  /** 可查询的日志日期及文件大小 */
  @Get('logs/dates')
  @RequirePermissions('system:log:list')
  dates() {
    return this.monitor.dates();
  }

  /** 系统日志检索：日期 + 级别 + 分类 + 关键字 + traceId */
  @Get('logs')
  @RequirePermissions('system:log:list')
  logs(@Query() query: QueryLogDto) {
    return this.monitor.logs(query);
  }

  /** 下载某天的原始日志文件（大范围分析用） */
  @Get('logs/download')
  @RequirePermissions('system:log:download')
  @OperateLog({ module: '日志审计', action: '下载日志' })
  download(@Query() query: LogDateDto, @Res() res: Response) {
    const path = this.monitor.downloadPath(query.date);
    res.download(path, basename(path));
  }

  @Get('login-logs')
  @RequirePermissions('system:loginlog:list')
  loginLogs(@Query() query: QueryLoginLogDto) {
    return this.monitor.loginLogs(query);
  }

  @Get('operate-logs')
  @RequirePermissions('system:operatelog:list')
  operateLogs(@Query() query: QueryOperateLogDto) {
    return this.monitor.operateLogs(query);
  }
}

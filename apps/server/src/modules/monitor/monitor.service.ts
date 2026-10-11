import { Injectable } from '@nestjs/common';
import { LogEntry, LogReaderService, LogSource } from '../../core/logger/log-reader.service';
import { QueryLogDto, QueryLoginLogDto, QueryOperateLogDto } from './monitor.dto';

const includes = (v: unknown, kw: string) => typeof v === 'string' && v.includes(kw);
const successMatch = (e: LogEntry, success?: string) => success === undefined || e.success === (success === 'true');

/**
 * 日志审计：唯一数据源是日志文件（LOG_DIR/app.YYYY-MM-DD.log），不查库。
 * 登录/操作日志只是 category=audit 下按 event 过滤的视图。
 */
@Injectable()
export class MonitorService {
  constructor(private readonly reader: LogReaderService) {}

  dates() {
    return this.reader.listFiles();
  }

  logs(q: QueryLogDto) {
    return this.reader.query({
      date: q.date,
      level: q.level,
      category: q.category,
      keyword: q.keyword,
      traceId: q.traceId,
      source: (q.source as LogSource) || 'server',
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  downloadPath(date?: string, source?: string) {
    return this.reader.existingFile(date, (source as LogSource) || 'server');
  }

  loginLogs(q: QueryLoginLogDto) {
    return this.reader.query({
      date: q.date,
      category: 'audit',
      keyword: q.keyword,
      match: (e) =>
        e.event === 'login' && (!q.keyword || includes(e.username, q.keyword)) && successMatch(e, q.success),
      page: q.page,
      pageSize: q.pageSize,
    });
  }

  operateLogs(q: QueryOperateLogDto) {
    return this.reader.query({
      date: q.date,
      category: 'audit',
      keyword: q.keyword,
      match: (e) =>
        e.event === 'operate' &&
        (!q.module || e.module === q.module) &&
        (!q.keyword || ['username', 'module', 'action'].some((k) => includes(e[k], q.keyword!))) &&
        successMatch(e, q.success),
      page: q.page,
      pageSize: q.pageSize,
    });
  }
}

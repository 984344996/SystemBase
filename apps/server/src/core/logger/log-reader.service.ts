import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { PageResult } from '@sb/shared';
import { CLIENT_LOG_FILE_RE, clientLogFileName, formatLocalDate, LOG_DATE_RE, LOG_FILE_RE, logFileName } from './log-streams';

/** 日志来源：server=后端 app.*.log / client=前端 web.*.log */
export type LogSource = 'server' | 'client';

export interface LogEntry {
  level: string;
  time: string;
  category?: string;
  traceId?: string;
  msg?: string;
  [key: string]: unknown;
}

export interface LogQuery {
  /** YYYY-MM-DD，缺省今天 */
  date?: string;
  level?: string;
  category?: string;
  /** 原始行包含该文本（大小写敏感） */
  keyword?: string;
  traceId?: string;
  /** 解析后的精确过滤（业务语义，如 event==='login'） */
  match?: (entry: LogEntry) => boolean;
  /** 日志来源：server=后端日志 / client=前端日志（独立文件） */
  source?: LogSource;
  page: number;
  pageSize: number;
}

export interface LogPage extends PageResult<LogEntry> {
  date: string;
  /** 命中条数超过缓冲上限，更早的记录未保留（请缩小条件或下载原文件） */
  truncated: boolean;
}

/** 单次查询最多保留的命中条数（按时间倒序取最新）；控制内存，超出请下载原文件分析 */
const MAX_KEEP = 5000;

/**
 * 日志文件读取：按天文件流式逐行扫描 + 条件过滤 + 倒序分页。
 * 中小规模（单日百 MB 以内）直接可用；更大体量建议接入 Loki/ELK。
 */
@Injectable()
export class LogReaderService {
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.get<string>('LOG_DIR') || 'logs');
  }

  /** 可查询的日志日期（倒序） */
  listFiles(): { date: string; size: number }[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .map((name) => LOG_FILE_RE.exec(name))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ date: m[1], size: statSync(join(this.dir, m[0])).size }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /** 日期 -> 文件绝对路径（严格校验格式，杜绝路径穿越）；source=client 读前端日志 web.*.log */
  filePath(date?: string, source: LogSource = 'server'): string {
    const d = date || formatLocalDate();
    if (!LOG_DATE_RE.test(d)) throw new BadRequestException('日期格式应为 YYYY-MM-DD');
    return join(this.dir, source === 'client' ? clientLogFileName(d) : logFileName(d));
  }

  /** 已存在的日志文件路径（下载用） */
  existingFile(date?: string, source: LogSource = 'server'): string {
    const path = this.filePath(date, source);
    if (!existsSync(path)) throw new NotFoundException(`${date || '今天'} 没有日志文件`);
    return path;
  }

  async query(q: LogQuery): Promise<LogPage> {
    const date = q.date || formatLocalDate();
    const path = this.filePath(date, q.source || 'server');
    const empty: LogPage = { list: [], total: 0, page: q.page, pageSize: q.pageSize, date, truncated: false };
    if (!existsSync(path)) return empty;

    // 廉价的字符串预过滤，命中后才 JSON.parse
    const needles = [
      q.level ? `"level":"${q.level}"` : '',
      q.category ? `"category":"${q.category}"` : '',
      q.traceId ? `"traceId":"${q.traceId}"` : '',
      q.keyword || '',
    ].filter(Boolean);

    const ring: LogEntry[] = new Array(MAX_KEEP);
    let total = 0;
    const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line || !needles.every((n) => line.includes(n))) continue;
      let entry: LogEntry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // 正在写入的半行 / 非 JSON 行
      }
      if (q.match && !q.match(entry)) continue;
      ring[total % MAX_KEEP] = entry;
      total++;
    }

    // 还原为时间倒序（最新在前）
    const kept = Math.min(total, MAX_KEEP);
    const start = (q.page - 1) * q.pageSize;
    const list: LogEntry[] = [];
    for (let i = start; i < Math.min(start + q.pageSize, kept); i++) {
      list.push(ring[(total - 1 - i) % MAX_KEEP]);
    }
    return { list, total, page: q.page, pageSize: q.pageSize, date, truncated: total > MAX_KEEP };
  }
}

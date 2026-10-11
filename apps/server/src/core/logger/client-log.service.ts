import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { Level, Logger } from 'pino';
import { CLIENT_LOG_FILE_PREFIX, DailyFileStream, formatLocalTime } from './log-streams';

export interface ClientLogFields {
  /** 页面路径（已去掉 query，避免带上 token 等敏感参数） */
  url?: string;
  /** 浏览器 UA（截断保存） */
  ua?: string;
  /** 错误堆栈（截断） */
  stack?: string;
  traceId?: string;
  userId?: number;
  /** 前端版本号（RELEASE 里的 release 时间戳） */
  release?: string;
  [key: string]: unknown;
}

export type ClientLogLevel = 'info' | 'warn' | 'error';

/** 单条上报的长度上限：防止恶意/异常客户端写入超大内容拖垮磁盘 */
const MAX_MSG = 1000;
const MAX_STACK = 2000;
const MAX_UA = 300;
const MAX_URL = 300;

/**
 * 前端（浏览器）日志落盘：
 *
 * 为什么与后端日志分开成文件（web.YYYY-MM-DD.log）：
 * - 量级不同：同一前端错误会被 N 个浏览器各报一次，混进 app 日志会淹没后端 ERROR，
 *   也会让「日志告警任务」统计失真
 * - 视角不同：后端是服务器视角，前端是客户端视角
 * - 仍然可串联：前端上报时带上请求用的 traceId，两个文件 grep 同一个 traceId 即可拼出完整链路
 *
 * 存储与清理规则与后端日志一致（同目录、按天切分、LOG_KEEP_DAYS 天保留）。
 */
@Injectable()
export class ClientLogService implements OnApplicationShutdown {
  private readonly file: DailyFileStream;
  private readonly logger: Logger;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    const dir = config.get<string>('LOG_DIR') || 'logs';
    const keepDays = Math.max(1, Number(config.get<string>('LOG_KEEP_DAYS') || 30));
    this.enabled = String(config.get<string>('CLIENT_LOG_ENABLED') || 'on').toLowerCase() !== 'off';
    this.file = new DailyFileStream(dir, keepDays, CLIENT_LOG_FILE_PREFIX);
    this.logger = pino(
      {
        level: 'info',
        base: null,
        timestamp: () => `,"time":"${formatLocalTime()}"`,
        formatters: { level: (label) => ({ level: label.toUpperCase() }) },
      },
      this.file,
    ).child({ category: 'client' });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 写一条前端日志（字段已做脱敏与长度截断） */
  write(level: ClientLogLevel, msg: string, fields: ClientLogFields = {}): void {
    if (!this.enabled) return;
    const safe: Record<string, unknown> = {
      msg: clip(msg, MAX_MSG),
      url: clip(fields.url, MAX_URL),
      ua: clip(fields.ua, MAX_UA),
    };
    if (fields.stack) safe.stack = clip(fields.stack, MAX_STACK);
    if (fields.traceId) safe.traceId = clip(fields.traceId, 64);
    if (fields.userId !== undefined) safe.userId = fields.userId;
    if (fields.release) safe.release = clip(fields.release, 64);
    // 其余业务字段一并保留（调用方已做脱敏）
    for (const [k, v] of Object.entries(fields)) {
      if (['url', 'ua', 'stack', 'traceId', 'userId', 'release'].includes(k)) continue;
      safe[k] = v;
    }
    this.logger[level](safe);
  }

  onApplicationShutdown() {
    this.file.flushSync();
  }
}

/** 超长内容截断并标注，避免单条日志过大 */
export function clip(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  return s.length > max ? `${s.slice(0, max)}…[truncated ${s.length - max} chars]` : s;
}

/** URL 只保留 origin + pathname：query 里可能有 token、手机号等敏感信息 */
export function sanitizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    // 不是完整 URL（如相对路径）时，只取问号前的部分
    return String(raw).split('?')[0].slice(0, MAX_URL);
  }
}

export function levelOf(v: unknown): ClientLogLevel {
  const s = String(v || 'error').toLowerCase();
  return s === 'warn' || s === 'info' ? s : 'error';
}

export const CLIENT_LEVELS: Level[] = ['info', 'warn', 'error'];

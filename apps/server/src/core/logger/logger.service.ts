import { Injectable, LoggerService as NestLoggerService, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import pino, { Level, Logger, StreamEntry } from 'pino';
import { getTraceId } from './trace.context';
import { createConsoleStream, DailyFileStream, formatLocalTime } from './log-streams';

export interface LogFields {
  [key: string]: unknown;
}

/** 日志分类：同一文件内用 category 字段区分 */
export type LogCategory = 'app' | 'access' | 'audit' | 'job';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const REDACT_PATHS = [
  'req.headers.authorization',
  'password',
  '*.password',
  'oldPassword',
  '*.oldPassword',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'accessToken',
  '*.accessToken',
];

/**
 * 日志服务（系统唯一日志出口，不落库）：
 *
 * 文件：LOG_DIR/app.YYYY-MM-DD.log，每天一个，保留 LOG_KEEP_DAYS 天自动清理。
 * 每行一条 JSON，固定字段在前：
 *   {"level":"INFO","time":"2026-09-30 14:03:22.123","category":"access","traceId":"…", …, "msg":"…"}
 *
 * - level    DEBUG / INFO / WARN / ERROR / FATAL（字符串，grep '"level":"ERROR"' 即可定位错误）
 * - category app(应用/框架) / access(HTTP 访问) / audit(登录与操作审计) / job(定时任务)
 * - traceId  请求级链路 ID，响应头 X-Trace-Id 同值，报障时凭它串起整条链路
 */
@Injectable()
export class AppLogger implements NestLoggerService, OnApplicationShutdown {
  private readonly file: DailyFileStream;
  private readonly root: Logger;
  private readonly loggers: Record<LogCategory, Logger>;

  constructor(config: ConfigService) {
    const dir = config.get<string>('LOG_DIR') || 'logs';
    const keepDays = Math.max(1, Number(config.get<string>('LOG_KEEP_DAYS') || 30));
    const nodeEnv = config.get<string>('NODE_ENV') || 'development';
    const level = (config.get<string>('LOG_LEVEL') || (nodeEnv === 'production' ? 'info' : 'debug')) as Level;

    this.file = new DailyFileStream(dir, keepDays);
    const streams: StreamEntry[] = [{ level, stream: this.file }];
    if (nodeEnv === 'development') streams.push({ level, stream: createConsoleStream() });

    this.root = pino(
      {
        level,
        base: null, // 不输出 pid/hostname，保持单行紧凑
        timestamp: () => `,"time":"${formatLocalTime()}"`,
        formatters: { level: (label) => ({ level: label.toUpperCase() }) },
        redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      },
      pino.multistream(streams),
    );
    this.loggers = {
      app: this.root.child({ category: 'app' }),
      access: this.root.child({ category: 'access' }),
      audit: this.root.child({ category: 'audit' }),
      job: this.root.child({ category: 'job' }),
    };
  }

  onApplicationShutdown() {
    this.file.flushSync();
  }

  /** 统一写入口：自动附带当前请求 traceId */
  write(category: LogCategory, level: LogLevel, fields: LogFields | undefined, msg: string) {
    const traceId = getTraceId();
    this.loggers[category][level]({ ...(traceId ? { traceId } : {}), ...(fields || {}) }, msg);
  }

  // ---- Nest LoggerService 接口（框架内部与 new Logger(ctx) 的日志也走这里） ----
  log(message: unknown, ...params: unknown[]) {
    this.nest('info', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.nest('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.nest('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.nest('debug', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    // Nest 约定：error(message, stack?, context?)
    const context = params.length ? String(params[params.length - 1]) : undefined;
    const stack = params.length > 1 ? String(params[0]) : message instanceof Error ? message.stack : undefined;
    this.write('app', 'error', { context, ...(stack ? { stack } : {}) }, this.text(message));
  }
  fatal(message: unknown, ...params: unknown[]) {
    const context = params.length ? String(params[params.length - 1]) : undefined;
    this.loggers.app.fatal({ traceId: getTraceId(), context }, this.text(message));
  }

  // ---- 业务结构化方法（字段在前、消息在后） ----
  debugFields(fields: LogFields, msg: string) {
    this.write('app', 'debug', fields, msg);
  }
  info(fields: LogFields, msg: string) {
    this.write('app', 'info', fields, msg);
  }
  warnFields(fields: LogFields, msg: string) {
    this.write('app', 'warn', fields, msg);
  }
  errorFields(fields: LogFields, msg: string) {
    this.write('app', 'error', fields, msg);
  }

  /** HTTP 访问日志：级别由调用方按状态码决定 */
  access(fields: LogFields, msg: string, level: LogLevel = 'info') {
    this.write('access', level, fields, msg);
  }

  /** 审计日志：登录、写操作等「谁在什么时候做了什么」 */
  audit(fields: LogFields, msg: string, level: LogLevel = 'info') {
    this.write('audit', level, fields, msg);
  }

  /** 定时任务日志 */
  job(fields: LogFields, msg: string) {
    this.write('job', 'info', fields, msg);
  }
  jobWarn(fields: LogFields, msg: string) {
    this.write('job', 'warn', fields, msg);
  }
  jobError(fields: LogFields, msg: string) {
    this.write('job', 'error', fields, msg);
  }

  /** 生成新 traceId */
  newTraceId(): string {
    return randomUUID().replace(/-/g, '');
  }

  private nest(level: LogLevel, message: unknown, params: unknown[]) {
    const context = params.length ? String(params[params.length - 1]) : undefined;
    const fields = message && typeof message === 'object' && !(message instanceof Error) ? (message as LogFields) : {};
    this.write('app', level, { context, ...fields }, this.text(message));
  }

  private text(message: unknown): string {
    if (message instanceof Error) return message.message;
    if (message && typeof message === 'object') return String((message as { msg?: unknown }).msg ?? '');
    return String(message);
  }
}

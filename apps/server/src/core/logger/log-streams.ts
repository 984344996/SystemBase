import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';

/**
 * 日志文件命名：每天一个文件 `app.YYYY-MM-DD.log`（按服务器本地时区切日）。
 * 所有级别(DEBUG/INFO/WARN/ERROR/FATAL)、所有分类(app/access/audit/job)写同一个文件，
 * 用 level / category 字段区分，grep 或管理页按字段过滤即可。
 */
export const LOG_FILE_PREFIX = 'app';
/** 前端（浏览器）日志独立文件：与后端日志分开，避免同一错误被多客户端重复上报淹没后端 ERROR */
export const CLIENT_LOG_FILE_PREFIX = 'web';
export const LOG_FILE_RE = /^app\.(\d{4}-\d{2}-\d{2})\.log$/;
export const CLIENT_LOG_FILE_RE = /^web\.(\d{4}-\d{2}-\d{2})\.log$/;
export const LOG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 本地日期 "YYYY-MM-DD" */
export function formatLocalDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时间 "YYYY-MM-DD HH:mm:ss.SSS"（日志 time 字段，排障时直接对照墙上时钟） */
export function formatLocalTime(d: Date = new Date()): string {
  return `${formatLocalDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function logFileName(date: string): string {
  return `${LOG_FILE_PREFIX}.${date}.log`;
}

export function clientLogFileName(date: string): string {
  return `${CLIENT_LOG_FILE_PREFIX}.${date}.log`;
}

type Destination = ReturnType<typeof pino.destination>;

/**
 * 按天滚动的文件输出流：
 * - 跨过本地零点后第一条日志触发切换到新文件
 * - 每次切换时清理超过 keepDays 天的旧文件（含当天共保留 keepDays 个）
 * - 异步写（不阻塞事件循环），进程退出时同步刷盘
 */
export class DailyFileStream {
  private dest: Destination | null = null;
  private nextRotateAt = 0;

  constructor(
    private readonly dir: string,
    private readonly keepDays: number,
    /** 文件名前缀（app=后端日志 / web=前端日志）；清理时只清理同前缀的文件 */
    private readonly prefix: string = LOG_FILE_PREFIX,
  ) {
    mkdirSync(dir, { recursive: true });
    process.once('exit', () => this.flushSync());
  }

  write(chunk: string): void {
    if (Date.now() >= this.nextRotateAt) this.rotate();
    this.dest!.write(chunk);
  }

  flushSync(): void {
    try {
      this.dest?.flushSync();
    } catch {
      /* 文件尚未打开或正在写入时忽略 */
    }
  }

  /** 关闭当前文件（测试/优雅退出用），resolve 于文件句柄关闭后 */
  close(): Promise<void> {
    const dest = this.dest;
    this.dest = null;
    this.nextRotateAt = 0;
    if (!dest) return Promise.resolve();
    return new Promise((resolve) => {
      dest.once('close', () => resolve());
      dest.once('error', () => resolve());
      dest.end();
    });
  }

  private rotate(): void {
    const now = new Date();
    const old = this.dest;
    const dest = pino.destination({
      dest: join(this.dir, this.prefix === CLIENT_LOG_FILE_PREFIX ? clientLogFileName(formatLocalDate(now)) : logFileName(formatLocalDate(now))),
      sync: false,
      mkdir: true,
      append: true,
    });
    // 必须监听 error：否则日志目录被删/磁盘满等 IO 异常会作为未处理事件直接打崩进程
    dest.on('error', (err: Error) => {
      process.stderr.write(`[logger] 日志文件写入失败: ${err.message}\n`);
      this.nextRotateAt = 0; // 下一条日志触发重建文件
    });
    this.dest = dest;
    old?.end();

    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    this.nextRotateAt = next.getTime();
    this.cleanup(now);
  }

  private cleanup(now: Date): void {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - (this.keepDays - 1));
    const cutoffStr = formatLocalDate(cutoff);
    try {
      const re = this.prefix === CLIENT_LOG_FILE_PREFIX ? CLIENT_LOG_FILE_RE : LOG_FILE_RE;
      for (const name of readdirSync(this.dir)) {
        const m = re.exec(name);
        if (m && m[1] < cutoffStr) unlinkSync(join(this.dir, name));
      }
    } catch {
      /* 清理失败不影响写日志 */
    }
  }
}

const COLORS: Record<string, string> = {
  TRACE: '\x1b[90m',
  DEBUG: '\x1b[90m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
  FATAL: '\x1b[35m',
};

/** 开发环境控制台输出：一行一条、按级别着色，其余字段附在末尾 */
export function createConsoleStream() {
  return {
    write(line: string) {
      try {
        const { level, time, category, context, msg, ...rest } = JSON.parse(line);
        const color = COLORS[level] || '';
        const extra = Object.keys(rest).length ? ` \x1b[90m${JSON.stringify(rest)}\x1b[0m` : '';
        process.stdout.write(
          `${String(time).slice(11, 19)} ${color}${String(level).padEnd(5)}\x1b[0m [${context || category}] ${msg ?? ''}${extra}\n`,
        );
      } catch {
        process.stdout.write(line);
      }
    },
  };
}

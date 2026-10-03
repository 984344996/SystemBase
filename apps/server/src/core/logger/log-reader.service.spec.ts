import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { LogReaderService } from './log-reader.service';
import { AppLogger } from './logger.service';
import { runWithTraceId } from './trace.context';
import { DailyFileStream, formatLocalDate, logFileName } from './log-streams';

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe('日志文件：写入 / 清理 / 查询', () => {
  let dir: string;
  let reader: LogReaderService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sb-log-'));
    reader = new LogReaderService(new ConfigService({ LOG_DIR: dir }));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('DailyFileStream 写入当天文件，并清理超出保留期的旧文件', async () => {
    writeFileSync(join(dir, 'app.2000-01-01.log'), 'old\n');
    writeFileSync(join(dir, 'other.txt'), 'keep\n'); // 非日志文件不动
    const stream = new DailyFileStream(dir, 7);
    stream.write('{"level":"INFO","msg":"hello"}\n');
    await stream.close(); // 等待异步写入落盘并关闭句柄

    const todayFile = join(dir, logFileName(formatLocalDate()));
    expect(existsSync(join(dir, 'app.2000-01-01.log'))).toBe(false);
    expect(existsSync(join(dir, 'other.txt'))).toBe(true);
    expect(readFileSync(todayFile, 'utf8')).toContain('hello');
  });

  it('按级别 / 分类 / traceId 过滤，结果最新在前并正确分页', async () => {
    const date = '2026-09-30';
    const rows = [
      line({ level: 'INFO', time: `${date} 10:00:00.000`, category: 'access', traceId: 't1', msg: 'a' }),
      line({ level: 'WARN', time: `${date} 10:00:01.000`, category: 'audit', traceId: 't1', event: 'login', msg: 'b' }),
      '{"level":"ERROR", 半行损坏',
      line({ level: 'ERROR', time: `${date} 10:00:02.000`, category: 'app', traceId: 't2', msg: 'c' }),
      line({ level: 'INFO', time: `${date} 10:00:03.000`, category: 'access', traceId: 't2', msg: 'd' }),
    ];
    writeFileSync(join(dir, logFileName(date)), rows.join('\n') + '\n');

    const all = await reader.query({ date, page: 1, pageSize: 10 });
    expect(all.total).toBe(4); // 损坏行被跳过
    expect(all.list.map((e) => e.msg)).toEqual(['d', 'c', 'b', 'a']);

    expect((await reader.query({ date, level: 'ERROR', page: 1, pageSize: 10 })).list.map((e) => e.msg)).toEqual(['c']);
    expect((await reader.query({ date, category: 'access', page: 1, pageSize: 10 })).total).toBe(2);
    expect((await reader.query({ date, traceId: 't1', page: 1, pageSize: 10 })).list.map((e) => e.msg)).toEqual(['b', 'a']);
    expect(
      (await reader.query({ date, match: (e) => e.event === 'login', page: 1, pageSize: 10 })).list.map((e) => e.msg),
    ).toEqual(['b']);

    const page2 = await reader.query({ date, page: 2, pageSize: 3 });
    expect(page2.list.map((e) => e.msg)).toEqual(['a']);
    expect(page2.truncated).toBe(false);
  });

  it('AppLogger：级别为可读字符串、带 category/traceId、敏感字段脱敏、低于 LOG_LEVEL 不输出', async () => {
    const logger = new AppLogger(new ConfigService({ LOG_DIR: dir, NODE_ENV: 'production', LOG_LEVEL: 'info' }));
    runWithTraceId('trace-abc-123', () => {
      logger.info({ userId: 1 }, '普通信息');
      logger.warnFields({ password: 'secret' }, '警告示例');
      logger.errorFields({ status: 500 }, '错误示例');
      logger.debugFields({}, '不应出现');
      logger.audit({ event: 'login', username: 'admin', success: false }, '登录失败', 'warn');
      logger.log('框架日志', 'RoutesResolver');
    });
    await (logger as any).file.close();

    const entries = readFileSync(join(dir, logFileName(formatLocalDate())), 'utf8').trim().split('\n').map((s) => JSON.parse(s));
    expect(entries.map((e) => e.level)).toEqual(['INFO', 'WARN', 'ERROR', 'WARN', 'INFO']);
    expect(entries.map((e) => e.category)).toEqual(['app', 'app', 'app', 'audit', 'app']);
    expect(entries.every((e) => e.traceId === 'trace-abc-123')).toBe(true);
    expect(entries[0].time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(entries[1].password).toBe('[REDACTED]');
    expect(entries[4].context).toBe('RoutesResolver');
    expect(entries.some((e) => e.msg === '不应出现')).toBe(false);
  });

  it('文件不存在返回空；非法日期拒绝（防路径穿越）', async () => {
    expect((await reader.query({ date: '2001-01-01', page: 1, pageSize: 10 })).total).toBe(0);
    expect(() => reader.filePath('../../etc/passwd')).toThrow();
    expect(() => reader.existingFile('2001-01-01')).toThrow();
  });
});

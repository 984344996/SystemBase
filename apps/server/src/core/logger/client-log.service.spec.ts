import { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientLogService, clip, levelOf, sanitizeUrl } from './client-log.service';
import { formatLocalDate } from './log-streams';

const dir = mkdtempSync(join(tmpdir(), 'sb-client-log-'));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(env: Record<string, string> = {}) {
  return new ClientLogService(new ConfigService({ LOG_DIR: dir, ...env }));
}

function lastLine(): string {
  const file = join(dir, `web.${formatLocalDate()}.log`);
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').pop() || '' : '';
}

/** pino 为异步写，断言前等待刷盘 */
const flush = () => new Promise((r) => setTimeout(r, 80));

describe('sanitizeUrl', () => {
  it('去掉 query，避免 token / 手机号等敏感参数落盘', () => {
    expect(sanitizeUrl('http://a.com/login?token=abc&phone=13800138000')).toBe('http://a.com/login');
  });
  it('非完整 URL 时取问号前部分', () => {
    expect(sanitizeUrl('/system/user?a=1')).toBe('/system/user');
  });
  it('空值返回 undefined', () => {
    expect(sanitizeUrl(undefined)).toBeUndefined();
  });
});

describe('clip / levelOf', () => {
  it('超长内容截断并标注长度', () => {
    expect(clip('x'.repeat(10), 5)).toContain('[truncated 5 chars]');
    expect(clip('abc', 5)).toBe('abc');
    expect(clip(undefined, 5)).toBeUndefined();
  });
  it('非法级别一律按 error 处理', () => {
    expect(levelOf('warn')).toBe('warn');
    expect(levelOf('info')).toBe('info');
    expect(levelOf('xxx')).toBe('error');
    expect(levelOf(undefined)).toBe('error');
  });
});

describe('ClientLogService', () => {
  it('写入独立文件 web.*.log，category=client', async () => {
    const s = setup();
    s.write('error', '前端炸了', { url: 'http://a.com/x', stack: 'Error: x' });
    s.onApplicationShutdown();
    await flush();
    const line = JSON.parse(lastLine());
    expect(line.category).toBe('client');
    expect(line.level).toBe('ERROR');
    expect(line.msg).toBe('前端炸了');
    expect(line.stack).toBe('Error: x');
  });

  it('CLIENT_LOG_ENABLED=off 时不写文件', () => {
    const off = mkdtempSync(join(tmpdir(), 'sb-off-'));
    const s = new ClientLogService(new ConfigService({ LOG_DIR: off, CLIENT_LOG_ENABLED: 'off' }));
    expect(s.isEnabled).toBe(false);
    s.write('error', '不该写入');
    s.onApplicationShutdown();
    expect(existsSync(join(off, `web.${new Date().toISOString().slice(0, 10)}.log`))).toBe(false);
    rmSync(off, { recursive: true, force: true });
  });

  it('超长 msg / ua 被截断，防止单条日志过大', async () => {
    const s = setup();
    s.write('error', 'x'.repeat(5000), { ua: 'u'.repeat(5000) });
    s.onApplicationShutdown();
    await flush();
    const line = JSON.parse(lastLine());
    expect(line.msg.length).toBeLessThan(1200);
    expect(line.ua.length).toBeLessThan(400);
  });

  it('带 traceId 与 userId 时一并记录（用于串联后端日志）', async () => {
    const s = setup();
    s.write('error', '报错', { traceId: 'abc123', userId: 7 });
    s.onApplicationShutdown();
    await flush();
    const line = JSON.parse(lastLine());
    expect(line.traceId).toBe('abc123');
    expect(line.userId).toBe(7);
  });
});

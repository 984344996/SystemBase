import { redact } from './operate-log.interceptor';

describe('operate-log redact（审计日志脱敏）', () => {
  it('敏感键名不区分大小写、覆盖常见变体', () => {
    const out = redact({
      password: 'a',
      confirmPassword: 'b',
      Password: 'c',
      captchaCode: 'd',
      webhookSecret: 'e',
      refreshToken: 'f',
      apiKey: 'g',
      name: '张三',
    }) as Record<string, unknown>;
    for (const k of ['password', 'confirmPassword', 'Password', 'captchaCode', 'webhookSecret', 'refreshToken', 'apiKey']) {
      expect(out[k]).toBe('[REDACTED]');
    }
    expect(out.name).toBe('张三');
  });

  it('超过深度直接截断（深层 password 不会原样写入日志）', () => {
    const out = JSON.stringify(redact({ a: { b: { c: { d: { password: 'leak' } } } } }));
    expect(out).not.toContain('leak');
    expect(out).toContain('[DEPTH_LIMIT]');
  });

  it('长字符串截断到 500 字符', () => {
    const out = redact({ text: 'x'.repeat(2000) }) as { text: string };
    expect(out.text.length).toBe(500);
  });
});

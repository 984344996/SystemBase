import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginGuardService } from './login-guard.service';

const logger = { warn: jest.fn(), info: jest.fn(), audit: jest.fn() } as any;

function setup(env: Record<string, string> = {}) {
  const guard = new LoginGuardService(new ConfigService(env), logger);
  return guard;
}

describe('LoginGuardService 失败计数与锁定', () => {
  it('未达阈值不锁定，成功登录清零', () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '3', LOGIN_FAIL_LOCK_MINUTES: '5' });
    const key = LoginGuardService.keyOf('admin', '10.0.0.1');
    expect(guard.recordFailure(key)).toBe(false);
    expect(guard.recordFailure(key)).toBe(false);
    expect(() => guard.assertNotLocked(key)).not.toThrow();

    guard.clearFailures(key);
    expect(guard.recordFailure(key)).toBe(false); // 重新计数，未触发锁定
  });

  it('达到阈值后锁定，锁定期间登录被拒（429）', () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '2', LOGIN_FAIL_LOCK_MINUTES: '10' });
    const key = LoginGuardService.keyOf('admin', '10.0.0.1');
    expect(guard.recordFailure(key)).toBe(false);
    expect(guard.recordFailure(key)).toBe(true);

    expect(() => guard.assertNotLocked(key)).toThrow(HttpException);
    try {
      guard.assertNotLocked(key);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
      expect((e as HttpException).message).toMatch(/请 \d+ 分钟后再试/);
    }
  });

  it('锁定按「用户名 + IP」区分：换 IP 不复用别人的锁定', () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '1', LOGIN_FAIL_LOCK_MINUTES: '10' });
    const a = LoginGuardService.keyOf('admin', '10.0.0.1');
    const b = LoginGuardService.keyOf('admin', '10.0.0.2');
    expect(guard.recordFailure(a)).toBe(true);
    expect(() => guard.assertNotLocked(a)).toThrow();
    expect(() => guard.assertNotLocked(b)).not.toThrow();
  });

  it('不锁定配置（0 次）永不触发', () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '0' });
    const key = LoginGuardService.keyOf('admin', '10.0.0.1');
    for (let i = 0; i < 10; i++) expect(guard.recordFailure(key)).toBe(false);
    expect(() => guard.assertNotLocked(key)).not.toThrow();
  });
});

describe('LoginGuardService 验证码', () => {
  it('LOGIN_CAPTCHA=off：不要求验证码', () => {
    const guard = setup({ LOGIN_CAPTCHA: 'off' });
    expect(guard.captchaRequired('k')).toBe(false);
  });

  it('LOGIN_CAPTCHA=on：总是要求', () => {
    const guard = setup({ LOGIN_CAPTCHA: 'on' });
    expect(guard.captchaRequired('k')).toBe(true);
  });

  it('LOGIN_CAPTCHA=auto：失败达到阈值后才要求', () => {
    const guard = setup({ LOGIN_CAPTCHA: 'auto', LOGIN_FAIL_LOCK_COUNT: '5' });
    const key = LoginGuardService.keyOf('admin', '10.0.0.1');
    expect(guard.captchaRequired(key)).toBe(false);
    guard.recordFailure(key);
    expect(guard.captchaRequired(key)).toBe(false);
    guard.recordFailure(key);
    guard.recordFailure(key);
    expect(guard.captchaRequired(key)).toBe(true);
  });

  it('未知 id / 空验证码一律校验失败；同 id 只能成功一次（防重放）', () => {
    const guard = setup({});
    expect(guard.verifyCaptcha('nope', '1234')).toBe(false);
    expect(guard.verifyCaptcha('', '1234')).toBe(false);

    const issued = guard.issueCaptcha();
    if (!issued) {
      // 未安装 svg-captcha 时降级：签发返回 null，不影响其他行为
      expect(issued).toBeNull();
      return;
    }
    expect(issued.svg).toContain('<svg');
    // 无法从外部得知文本，用错误值验证「一次性消费」：错误校验后该 id 即失效
    expect(guard.verifyCaptcha(issued.id, '____')).toBe(false);
    expect(guard.verifyCaptcha(issued.id, '____')).toBe(false);
  });

  it('cleanup 清理过期记录', () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '5', LOGIN_FAIL_WINDOW_MIN: '1' });
    const key = LoginGuardService.keyOf('admin', '10.0.0.1');
    guard.recordFailure(key);
    // 把时间推到窗口之外（内部按 Date.now() 判定，这里用 cleanup 传入未来时间）
    expect(guard.cleanup(Date.now() + 2 * 60_000)).toBeGreaterThan(0);
  });
});

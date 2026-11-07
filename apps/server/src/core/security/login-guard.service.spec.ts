import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginGuardService } from './login-guard.service';
import { BizCode, BusinessException } from '../filter/business.exception';
import { SharedStoreService } from '../redis/shared-store.service';
import { localStore } from '../redis/testing';

const logger = { warn: jest.fn(), warnFields: jest.fn(), info: jest.fn(), audit: jest.fn() } as any;

/** 构造守卫；可传入共享存储模拟「多实例共用同一个 Redis」 */
function setup(env: Record<string, string> = {}, store: SharedStoreService = localStore()) {
  return new LoginGuardService(new ConfigService(env), logger, store);
}

describe('LoginGuardService 失败计数与锁定（账号@IP）', () => {
  it('未达阈值不锁定，成功登录清零', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '3', LOGIN_FAIL_LOCK_MINUTES: '5' });
    expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(false);
    expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(false);
    await expect(guard.assertNotLocked('admin', '10.0.0.1')).resolves.toBeUndefined();

    await guard.clearFailures('admin', '10.0.0.1');
    expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(false); // 重新计数，未触发锁定
  });

  it('达到阈值后锁定，锁定期间登录被拒（429 + 业务码 42901）', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '2', LOGIN_FAIL_LOCK_MINUTES: '10' });
    expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(false);
    expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(true);

    const err = await guard.assertNotLocked('admin', '10.0.0.1').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({ bizCode: BizCode.LOGIN_LOCKED });
    expect((err as HttpException).message).toMatch(/请 \d+ 分钟后再试/);
  });

  it('用户名不区分大小写', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '1' });
    await guard.recordFailure('Admin', '10.0.0.1');
    await expect(guard.assertNotLocked('admin', '10.0.0.1')).rejects.toBeInstanceOf(BusinessException);
  });

  it('「账号@IP」锁定只影响该 IP，其他 IP 登录同一账号不受牵连', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '1', LOGIN_FAIL_LOCK_MINUTES: '10' });
    expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(true);
    await expect(guard.assertNotLocked('admin', '10.0.0.1')).rejects.toBeInstanceOf(BusinessException);
    await expect(guard.assertNotLocked('admin', '10.0.0.2')).resolves.toBeUndefined();
  });

  it('不锁定配置（0 次）永不触发', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '0', LOGIN_FAIL_ACCOUNT_LOCK_COUNT: '0' });
    for (let i = 0; i < 10; i++) expect(await guard.recordFailure('admin', '10.0.0.1')).toBe(false);
    await expect(guard.assertNotLocked('admin', '10.0.0.1')).resolves.toBeUndefined();
  });
});

describe('LoginGuardService 账号级锁定（防轮换 IP 撞库）', () => {
  it('同一账号从不同 IP 累计失败达到账号阈值后，所有 IP 都被拒', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '5', LOGIN_FAIL_ACCOUNT_LOCK_COUNT: '3' });
    // 每个 IP 只失败 1 次，单 IP 计数永远到不了 5
    expect(await guard.recordFailure('admin', '1.1.1.1')).toBe(false);
    expect(await guard.recordFailure('admin', '2.2.2.2')).toBe(false);
    expect(await guard.recordFailure('admin', '3.3.3.3')).toBe(true);
    await expect(guard.assertNotLocked('admin', '9.9.9.9')).rejects.toBeInstanceOf(BusinessException);
    // 其他账号不受影响
    await expect(guard.assertNotLocked('other', '9.9.9.9')).resolves.toBeUndefined();
  });

  it('账号阈值默认是「账号@IP」阈值的 4 倍', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '2' });
    for (let i = 0; i < 7; i++) expect(await guard.recordFailure('admin', `10.0.0.${i}`)).toBe(false);
    expect(await guard.recordFailure('admin', '10.0.0.99')).toBe(true); // 第 8 次
  });
});

describe('LoginGuardService 验证码', () => {
  it('LOGIN_CAPTCHA=off：不要求验证码', async () => {
    expect(await setup({ LOGIN_CAPTCHA: 'off' }).captchaRequired('admin', 'ip')).toBe(false);
  });

  it('LOGIN_CAPTCHA=on：总是要求', async () => {
    expect(await setup({ LOGIN_CAPTCHA: 'on' }).captchaRequired('admin', 'ip')).toBe(true);
  });

  it('LOGIN_CAPTCHA=auto：失败达到阈值（3 次）后才要求；按账号累计也会触发', async () => {
    const guard = setup({ LOGIN_CAPTCHA: 'auto', LOGIN_FAIL_LOCK_COUNT: '5' });
    expect(await guard.captchaRequired('admin', '10.0.0.1')).toBe(false);
    await guard.recordFailure('admin', '10.0.0.1');
    await guard.recordFailure('admin', '10.0.0.2');
    expect(await guard.captchaRequired('admin', '10.0.0.3')).toBe(false);
    await guard.recordFailure('admin', '10.0.0.3');
    // 三个 IP 各失败一次：账号层累计 3 次，任何 IP 再登录都要验证码
    expect(await guard.captchaRequired('admin', '10.0.0.4')).toBe(true);
  });

  it('未知 id / 空验证码一律校验失败；同 id 只能校验一次（防重放）', async () => {
    const guard = setup({});
    expect(await guard.verifyCaptcha('nope', '1234')).toBe(false);
    expect(await guard.verifyCaptcha('', '1234')).toBe(false);

    const issued = await guard.issueCaptcha();
    if (!issued) return; // 未安装 svg-captcha 时降级为 null，不影响其他行为
    expect(issued.svg).toContain('<svg');
    // 无法从外部得知文本，用错误值验证「一次性消费」：错误校验后该 id 即失效
    expect(await guard.verifyCaptcha(issued.id, '____')).toBe(false);
    expect(await guard.verifyCaptcha(issued.id, '____')).toBe(false);
  });

  it('多实例共享存储：A 签发的验证码在 B 上可以校验通过', async () => {
    const store = localStore(); // 模拟两个实例共用同一个 Redis
    const a = setup({}, store);
    const b = setup({}, store);
    const issued = await a.issueCaptcha();
    if (!issued) return;
    const text = await store.get(`login:captcha:${issued.id}`);
    expect(await b.verifyCaptcha(issued.id, text!.toUpperCase())).toBe(true);
  });

  it('cleanup 清理过期记录', async () => {
    const guard = setup({ LOGIN_FAIL_LOCK_COUNT: '5', LOGIN_FAIL_WINDOW_MIN: '1' });
    await guard.recordFailure('admin', '10.0.0.1');
    expect(guard.cleanup(Date.now() + 2 * 60_000)).toBeGreaterThan(0);
  });
});

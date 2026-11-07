import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppLogger } from '../logger/logger.service';
import { SharedStoreService } from '../redis/shared-store.service';
import { BizCode, BusinessException } from '../filter/business.exception';

/** 验证码有效期 */
const CAPTCHA_TTL_MS = 5 * 60_000;

/**
 * 登录守卫：失败计数与锁定、验证码签发校验。
 *
 * 环境变量：
 *   LOGIN_FAIL_LOCK_COUNT          同一账号 + 同一 IP 连续失败几次后锁定该组合，默认 5，0 = 不锁定
 *   LOGIN_FAIL_ACCOUNT_LOCK_COUNT  同一账号（不论来自哪个 IP）累计失败几次后锁定账号，
 *                                  默认为 LOGIN_FAIL_LOCK_COUNT 的 4 倍，0 = 不按账号锁定
 *   LOGIN_FAIL_LOCK_MINUTES        锁定时长（分钟），默认 10
 *   LOGIN_FAIL_WINDOW_MIN          失败计数窗口（分钟，超时重新计数），默认 30
 *   LOGIN_CAPTCHA                  off（默认）| auto（失败达阈值后要求）| on（总是要求）
 *
 * 两层计数：
 *   - 「账号@IP」：正常用户输错密码几次就锁定，只影响这个 IP，别人用同一账号不受牵连
 *   - 「账号」：攻击者轮换 IP 撞同一个账号时，单个 IP 的计数永远到不了阈值，靠账号层兜底；
 *     阈值放宽（默认 4 倍），避免恶意请求轻易把真实用户锁在外面
 *   auto 验证码模式下任一层达到阈值（3 次）就要求验证码
 *
 * 存储：SharedStoreService（LOCK_DRIVER=redis 时多实例共享；否则本进程内存，带过期清理与容量上限）。
 * 验证码同样存在共享存储里，多实例下 A 实例签发的验证码到 B 实例也能校验。
 */
@Injectable()
export class LoginGuardService {
  private captchaWarned = false;

  private readonly lockCount: number;
  private readonly accountLockCount: number;
  private readonly lockMs: number;
  private readonly windowMs: number;
  private readonly captchaMode: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
    private readonly store: SharedStoreService,
  ) {
    this.lockCount = Number(this.config.get('LOGIN_FAIL_LOCK_COUNT') ?? 5);
    this.accountLockCount = Number(this.config.get('LOGIN_FAIL_ACCOUNT_LOCK_COUNT') ?? this.lockCount * 4);
    this.lockMs = Number(this.config.get('LOGIN_FAIL_LOCK_MINUTES') ?? 10) * 60_000;
    this.windowMs = Number(this.config.get('LOGIN_FAIL_WINDOW_MIN') ?? 30) * 60_000;
    this.captchaMode = String(this.config.get('LOGIN_CAPTCHA') ?? 'off').toLowerCase();
  }

  // ---------- 键名 ----------

  /** 用户名统一小写（登录不区分大小写时避免绕过） */
  private static norm(username: string): string {
    return (username || '').toLowerCase();
  }
  private static ipKey(username: string, ip?: string): string {
    return `${LoginGuardService.norm(username)}@${ip || '-'}`;
  }
  private keys(username: string, ip?: string) {
    const ipKey = LoginGuardService.ipKey(username, ip);
    const acct = LoginGuardService.norm(username);
    return {
      ipFail: `login:fail:ip:${ipKey}`,
      ipLock: `login:lock:ip:${ipKey}`,
      acctFail: `login:fail:acct:${acct}`,
      acctLock: `login:lock:acct:${acct}`,
    };
  }

  // ---------- 失败计数与锁定 ----------

  /** 未锁定直接返回；「账号@IP」或「账号」任一被锁定抛 429（业务码 42901）并提示剩余分钟 */
  async assertNotLocked(username: string, ip?: string): Promise<void> {
    const k = this.keys(username, ip);
    const left = Math.max(await this.store.pttl(k.ipLock), await this.store.pttl(k.acctLock));
    if (left <= 0) return;
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    throw new BusinessException(
      BizCode.LOGIN_LOCKED,
      `连续登录失败次数过多，请 ${minutes} 分钟后再试`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** 记录一次失败，返回是否触发了锁定（阈值设为 1 时首次失败即锁定） */
  async recordFailure(username: string, ip?: string): Promise<boolean> {
    const k = this.keys(username, ip);
    const ipCount = (await this.store.incr(k.ipFail, this.windowMs)).count;
    const acctCount = (await this.store.incr(k.acctFail, this.windowMs)).count;
    let locked = false;
    if (this.lockCount > 0 && ipCount >= this.lockCount) {
      await this.store.set(k.ipLock, '1', this.lockMs);
      await this.store.del(k.ipFail); // 锁定到期后重新计数
      this.logger.warnFields({ event: 'login_locked', key: LoginGuardService.ipKey(username, ip) }, `登录失败 ${ipCount} 次，锁定 ${this.lockMs / 60_000} 分钟`);
      locked = true;
    }
    if (this.accountLockCount > 0 && acctCount >= this.accountLockCount) {
      await this.store.set(k.acctLock, '1', this.lockMs);
      await this.store.del(k.acctFail);
      this.logger.warnFields(
        { event: 'login_account_locked', username: LoginGuardService.norm(username) },
        `账号在 ${this.windowMs / 60_000} 分钟内累计登录失败 ${acctCount} 次（可能来自多个 IP），锁定账号 ${this.lockMs / 60_000} 分钟`,
      );
      locked = true;
    }
    return locked;
  }

  /** 登录成功：清零该账号的失败计数（已存在的锁定不受影响，锁定期间本来也登录不进来） */
  async clearFailures(username: string, ip?: string): Promise<void> {
    const k = this.keys(username, ip);
    await this.store.del(k.ipFail, k.acctFail);
  }

  /** 当前是否要求验证码：on 总是要求；auto 在「账号@IP」或「账号」失败达到阈值后要求 */
  async captchaRequired(username: string, ip?: string): Promise<boolean> {
    if (this.captchaMode === 'on') return true;
    if (this.captchaMode !== 'auto') return false;
    const threshold = Math.max(1, Math.min(this.lockCount || 3, 3));
    const k = this.keys(username, ip);
    const ipCount = Number((await this.store.get(k.ipFail)) ?? 0);
    const acctCount = Number((await this.store.get(k.acctFail)) ?? 0);
    return ipCount >= threshold || acctCount >= threshold;
  }

  // ---------- 验证码 ----------

  /**
   * 签发验证码：返回 { id, svg }。
   * 依赖 svg-captcha 未安装时返回 null（此时不强制要求验证码，仅告警一次）。
   * 验证码接口是公开的：存储有过期时间与容量上限（见 SharedStoreService），不会被刷爆内存
   */
  async issueCaptcha(): Promise<{ id: string; svg: string } | null> {
    let svgCaptcha: any;
    try {
      svgCaptcha = require('svg-captcha');
    } catch {
      if (!this.captchaWarned) {
        this.captchaWarned = true;
        this.logger.warnFields({}, 'LOGIN_CAPTCHA 已开启但未安装 svg-captcha，验证码功能不生效（pnpm --filter @sb/server add svg-captcha）');
      }
      return null;
    }
    const c = svgCaptcha.create({ size: 4, noise: 2, color: true, ignoreChars: '0o1ilI' });
    const id = randomUUID();
    await this.store.set(`login:captcha:${id}`, String(c.text).toLowerCase(), CAPTCHA_TTL_MS);
    return { id, svg: c.data as string };
  }

  /** 校验验证码：一次性（无论对错，校验后即失效，防重放）；不区分大小写 */
  async verifyCaptcha(id: string, code: string): Promise<boolean> {
    if (!id || !code) return false;
    const text = await this.store.take(`login:captcha:${id}`);
    return !!text && text === String(code).trim().toLowerCase();
  }

  /** 清理过期记录（进程内存模式；Redis 键靠自身过期）：system.cleanup 任务调用，返回清理条数 */
  cleanup(now = Date.now()): number {
    return this.store.sweep(now);
  }
}

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppLogger } from '../logger/logger.service';

/**
 * 登录守卫：失败计数与锁定、验证码签发校验。
 *
 * 环境变量：
 *   LOGIN_FAIL_LOCK_COUNT    连续失败几次后锁定，默认 5，0 = 不锁定
 *   LOGIN_FAIL_LOCK_MINUTES  锁定时长（分钟），默认 10
 *   LOGIN_FAIL_WINDOW_MIN    失败计数窗口（分钟，超时重新计数），默认 30
 *   LOGIN_CAPTCHA            off（默认）| auto（失败达阈值后要求）| on（总是要求）
 *
 * 实现取舍：计数与验证码存进程内（零外部依赖）。多实例部署时各实例独立计数，
 * 需要严格一致请配合 Redis（后续可替换为 LOCK_DRIVER=redis 下的共享存储）。
 */
interface FailRecord {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

@Injectable()
export class LoginGuardService {
  private readonly fails = new Map<string, FailRecord>();
  private readonly captchas = new Map<string, { text: string; expiresAt: number }>();
  private captchaWarned = false;

  private readonly lockCount: number;
  private readonly lockMinutes: number;
  private readonly windowMinutes: number;
  private readonly captchaMode: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.lockCount = Number(this.config.get('LOGIN_FAIL_LOCK_COUNT') ?? 5);
    this.lockMinutes = Number(this.config.get('LOGIN_FAIL_LOCK_MINUTES') ?? 10);
    this.windowMinutes = Number(this.config.get('LOGIN_FAIL_WINDOW_MIN') ?? 30);
    this.captchaMode = String(this.config.get('LOGIN_CAPTCHA') ?? 'off').toLowerCase();
  }

  /** 锁定键：用户名 + IP，避免同 IP 撞库拖垮单个账号，也避免换 IP 绕过锁定 */
  static keyOf(username: string, ip?: string): string {
    return `${(username || '').toLowerCase()}@${ip || '-'}`;
  }

  /** 未锁定则直接返回；已锁定抛 429 并提示剩余分钟 */
  assertNotLocked(key: string): void {
    const rec = this.fails.get(key);
    if (!rec?.lockedUntil) return;
    if (rec.lockedUntil > Date.now()) {
      const minutes = Math.ceil((rec.lockedUntil - Date.now()) / 60_000);
      throw new HttpException(`连续登录失败次数过多，请 ${minutes} 分钟后再试`, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.fails.delete(key); // 锁定到期，重新开始计数
  }

  /** 记录一次失败，返回是否已触发锁定（阈值设为 1 时首次失败即锁定） */
  recordFailure(key: string): boolean {
    const now = Date.now();
    let rec = this.fails.get(key);
    // 首次失败或超出计数窗口：重新开始计数
    if (!rec || (!rec.lockedUntil && now - rec.firstAt > this.windowMinutes * 60_000)) {
      rec = { count: 0, firstAt: now };
      this.fails.set(key, rec);
    }
    rec.count += 1;
    if (this.lockCount > 0 && rec.count >= this.lockCount) {
      rec.lockedUntil = now + this.lockMinutes * 60_000;
      this.logger.warnFields(
        { event: 'login_locked', key },
        `登录失败 ${rec.count} 次，锁定 ${this.lockMinutes} 分钟`,
      );
      return true;
    }
    return false;
  }

  clearFailures(key: string): void {
    this.fails.delete(key);
  }

  /** 当前是否要求验证码 */
  captchaRequired(key: string): boolean {
    if (this.captchaMode === 'on') return true;
    if (this.captchaMode !== 'auto') return false;
    const rec = this.fails.get(key);
    return !!rec && rec.count >= Math.max(1, Math.min(this.lockCount, 3));
  }

  /**
   * 签发验证码：返回 { id, svg }。
   * 依赖 svg-captcha 未安装时返回 null（此时不强制要求验证码，仅告警一次）。
   */
  issueCaptcha(): { id: string; svg: string } | null {
    let svgCaptcha: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    this.captchas.set(id, { text: String(c.text).toLowerCase(), expiresAt: Date.now() + 5 * 60_000 });
    return { id, svg: c.data as string };
  }

  /** 校验验证码：一次性（校验通过即失效）；不区分大小写 */
  verifyCaptcha(id: string, code: string): boolean {
    if (!id || !code) return false;
    const rec = this.captchas.get(id);
    if (!rec) return false;
    this.captchas.delete(id); // 一次性，防止重放
    if (rec.expiresAt < Date.now()) return false;
    return rec.text === String(code).trim().toLowerCase();
  }

  /** 定期清理过期验证码（由调用方（如 system.cleanup 任务）触发，也可不调用） */
  cleanup(now = Date.now()): number {
    let removed = 0;
    for (const [id, rec] of this.captchas) {
      if (rec.expiresAt < now) { this.captchas.delete(id); removed++; }
    }
    for (const [key, rec] of this.fails) {
      if (rec.lockedUntil && rec.lockedUntil < now) { this.fails.delete(key); removed++; }
      else if (!rec.lockedUntil && now - rec.firstAt > this.windowMinutes * 60_000) { this.fails.delete(key); removed++; }
    }
    return removed;
  }
}

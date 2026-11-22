import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SharedStoreService } from '../redis/shared-store.service';

/** "30d" / "12h" / "15m" / "60s" → 毫秒；格式不对时返回 fallback */
export function parseDuration(s: string | undefined, fallbackMs: number): number {
  const m = /^(\d+)([smhd])$/.exec((s || '').trim());
  if (!m) return fallbackMs;
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return Number(m[1]) * unit;
}

/**
 * accessToken 即时吊销（无需 token 黑名单表）。
 *
 * accessToken 是无状态 JWT，签发后在有效期内本来一直可用。这里在共享存储里记两类标记，
 * JwtStrategy 每次请求检查：
 *   - 会话吊销 sid:<会话ID>  → 登出：该会话签发的 accessToken 立即失效（其他设备不受影响）
 *   - 用户吊销 user:<用户ID> = 时间戳 → 检测到 refreshToken 重放：此前签发的全部 accessToken 失效
 * 标记只需保留「accessToken 最长有效期」那么久（之后旧 token 自然过期），所以存储量很小。
 *
 * LOCK_DRIVER=redis 时标记存在 Redis，多实例共享；否则存在进程内存，只对当前实例生效
 * （多实例部署请启用 Redis，与限流 / 登录锁定的要求一致）。
 */
@Injectable()
export class SessionRevocationService {
  private readonly ttlMs: number;

  constructor(
    config: ConfigService,
    private readonly store: SharedStoreService,
  ) {
    // 标记保留时长 = accessToken 有效期 + 1 分钟余量（时钟误差）
    this.ttlMs = parseDuration(config.get<string>('JWT_EXPIRES_IN'), 2 * 3_600_000) + 60_000;
  }

  /** 吊销一个登录会话（登出） */
  async revokeSession(sid: string): Promise<void> {
    await this.store.set(`auth:revoked-sid:${sid}`, '1', this.ttlMs);
  }

  /** 吊销某用户此刻之前签发的全部 accessToken（检测到 token 泄露时） */
  async revokeUser(userId: number): Promise<void> {
    await this.store.set(`auth:revoked-user:${userId}`, String(Date.now()), this.ttlMs);
  }

  /**
   * 检查 accessToken 是否已被吊销；返回原因文案，未吊销返回 null
   *   @param sid    token 的会话 ID（旧版本签发的 token 没有，跳过会话检查）
   *   @param iatSec token 签发时间（秒）
   */
  async revokedReason(userId: number, sid: string | undefined, iatSec: number | undefined): Promise<string | null> {
    const [sidMark, userMark] = await Promise.all([
      sid ? this.store.get(`auth:revoked-sid:${sid}`) : Promise.resolve(null),
      this.store.get(`auth:revoked-user:${userId}`),
    ]);
    if (sidMark) return '已退出登录，请重新登录';
    // iat 精度为秒：允许 1s 误差（与改密判定一致）
    if (userMark && iatSec !== undefined && iatSec * 1000 < Number(userMark) - 1000) {
      return '登录状态已失效，请重新登录';
    }
    return null;
  }
}

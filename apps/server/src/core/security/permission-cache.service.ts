import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from './jwt.strategy';

/** 查库前取的版本快照，写回时比对，防止「失效前发起的查询」把旧数据写回缓存 */
export interface CacheTicket {
  global: number;
  user: number;
}

interface Entry {
  user: AuthUser;
  expiresAt: number;
}

/** 缓存条目上限：超出时先清过期项，仍超出则整体清空（中小规模足够，避免无界增长） */
const MAX_ENTRIES = 10_000;

/**
 * 登录用户身份/角色/权限缓存（进程内）。
 *
 * 目的：JwtStrategy 每个请求都要 user→roles→menus 三层关联查询，缓存后 TTL 内只查一次。
 * 一致性：
 * - 本实例：用户/角色/菜单变更时由对应 Service 主动失效，立即生效
 * - 多实例：其他实例最多延迟 PERMISSION_CACHE_TTL 秒（默认 30）生效；要求强一致可设为 0 关闭缓存
 */
@Injectable()
export class PermissionCacheService {
  private readonly ttlMs: number;
  private readonly entries = new Map<number, Entry>();
  private globalVersion = 0;
  private readonly userVersions = new Map<number, number>();

  constructor(config: ConfigService) {
    this.ttlMs = Math.max(0, Number(config.get<string>('PERMISSION_CACHE_TTL') ?? 30)) * 1000;
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  ticket(userId: number): CacheTicket {
    return { global: this.globalVersion, user: this.userVersions.get(userId) ?? 0 };
  }

  get(userId: number): AuthUser | undefined {
    const e = this.entries.get(userId);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.entries.delete(userId);
      return undefined;
    }
    return e.user;
  }

  set(user: AuthUser, ticket: CacheTicket): void {
    if (!this.enabled) return;
    const now = this.ticket(user.id);
    if (now.global !== ticket.global || now.user !== ticket.user) return; // 期间发生过失效，丢弃
    if (this.entries.size >= MAX_ENTRIES) this.prune();
    this.entries.set(user.id, { user, expiresAt: Date.now() + this.ttlMs });
  }

  /** 单个用户变更（状态/角色/删除）后调用 */
  invalidateUser(userId: number): void {
    this.entries.delete(userId);
    this.userVersions.set(userId, (this.userVersions.get(userId) ?? 0) + 1);
  }

  /** 角色/菜单(权限点)变更后调用：影响面无法精确计算，全部失效 */
  invalidateAll(): void {
    this.globalVersion++;
    this.entries.clear();
    this.userVersions.clear(); // 全局版本已变，旧的用户版本不再有意义
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
  }
}

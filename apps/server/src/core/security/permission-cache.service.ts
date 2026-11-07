import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '../redis/event-bus.service';
import type { AuthUser } from './jwt.strategy';

/** 权限失效事件主题：payload 为 'all' 或 'user:<id>' */
const TOPIC = 'perm:invalidate';

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
 * - 多实例：LOCK_DRIVER=redis 时经事件广播立即失效；未启用 Redis 时其他实例最多延迟
 *   PERMISSION_CACHE_TTL 秒（默认 30）生效，要求强一致可设为 0 关闭缓存
 */
@Injectable()
export class PermissionCacheService {
  private readonly ttlMs: number;
  private readonly entries = new Map<number, Entry>();
  private globalVersion = 0;
  private readonly userVersions = new Map<number, number>();

  /**
   * 多实例一致性：失效事件经 EventBusService 广播（LOCK_DRIVER=redis 时跨实例，
   * 否则只在本进程），其他实例收到后立即丢弃缓存，不必等 PERMISSION_CACHE_TTL 过期。
   * 广播失败时退化为「仅本实例失效」，其他实例最多延迟 TTL 秒，不影响功能。
   */
  constructor(
    config: ConfigService,
    private readonly bus: EventBusService,
  ) {
    this.ttlMs = Math.max(0, Number(config.get<string>('PERMISSION_CACHE_TTL') ?? 30)) * 1000;
    // 本实例与其他实例的失效事件都走这里处理
    this.bus.subscribe(TOPIC, (payload) => this.apply(payload));
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
    this.bus.publish(TOPIC, `user:${userId}`);
  }

  /** 角色/菜单(权限点)变更后调用：影响面无法精确计算，全部失效 */
  invalidateAll(): void {
    this.bus.publish(TOPIC, 'all');
  }

  /** 执行失效（本实例发起或其他实例广播过来的都走这里） */
  private apply(payload: string): void {
    if (payload === 'all') {
      this.globalVersion++;
      this.entries.clear();
      this.userVersions.clear(); // 全局版本已变，旧的用户版本不再有意义
      return;
    }
    const id = Number(payload.replace('user:', ''));
    if (!Number.isInteger(id)) return;
    this.entries.delete(id);
    this.userVersions.set(id, (this.userVersions.get(id) ?? 0) + 1);
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(id);
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
  }
}

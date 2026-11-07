import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisClientService } from './redis-client.service';

/** 进程内存模式下最多保留的键数（超出时先清过期，再淘汰最早写入的） */
const MAX_MEMORY_KEYS = 100_000;
/** 进程内存模式的过期清理间隔 */
const SWEEP_INTERVAL_MS = 60_000;
/** Redis 故障告警的最小间隔（避免每个请求都打一条） */
const WARN_INTERVAL_MS = 60_000;

/** INCR 并在首次创建时设置过期时间，返回 [计数, 剩余毫秒]（原子操作） */
const INCR_WITH_TTL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); t = tonumber(ARGV[1]) end
return {n, t}`;

/** 读取后立即删除（一次性令牌用；兼容不支持 GETDEL 的老版本 Redis） */
const TAKE = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`;

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * 共享键值存储（带过期时间）：多实例需要共享的「短期状态」统一放这里，
 * 如登录验证码、登录失败计数、限流计数。
 *
 * - LOCK_DRIVER=redis：存 Redis（多实例共享）。Redis 暂时不可用时，本次操作退回本机内存并告警
 *   （登录失败计数等是「尽力而为」的防护，不能因为 Redis 故障让所有人都登录不了）
 * - 未启用 Redis：存进程内存（单实例部署足够；带过期清理与容量上限，不会无限增长）
 *
 * 键名会自动加 REDIS_KEY_PREFIX 前缀。值统一是字符串，结构化数据请自行 JSON 序列化。
 */
@Injectable()
export class SharedStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharedStoreService.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private sweepTimer?: NodeJS.Timeout;
  private lastWarnAt = 0;

  constructor(private readonly redis: RedisClientService) {}

  /** 是否为多实例共享（走 Redis） */
  get distributed(): boolean {
    return this.redis.enabled;
  }

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** 读取；不存在或已过期返回 null */
  async get(key: string): Promise<string | null> {
    return this.withRedis(
      (r) => r.get(this.redis.key(key)),
      () => this.memGet(key)?.value ?? null,
    );
  }

  /** 写入并设置过期时间（毫秒） */
  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.withRedis(
      async (r) => {
        await r.set(this.redis.key(key), value, 'PX', Math.max(1, Math.round(ttlMs)));
      },
      () => this.memSet(key, value, ttlMs),
    );
  }

  /** 读取后立即删除（一次性使用，如验证码）；不存在返回 null */
  async take(key: string): Promise<string | null> {
    return this.withRedis(
      async (r) => {
        // 键不存在时 Lua 返回 false：真实 Redis 转成 nil（null），部分客户端/模拟器原样返回 false
        const v = await r.eval(TAKE, 1, this.redis.key(key));
        return typeof v === 'string' ? v : null;
      },
      () => {
        const e = this.memGet(key);
        this.memory.delete(key);
        return e?.value ?? null;
      },
    );
  }

  /** 删除 */
  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.withRedis(
      async (r) => {
        await r.del(...keys.map((k) => this.redis.key(k)));
      },
      () => keys.forEach((k) => this.memory.delete(k)),
    );
  }

  /**
   * 计数 +1：键不存在时创建并设置过期时间 ttlMs（固定窗口，过期时间不随后续 +1 延长）。
   * 返回当前计数与剩余毫秒
   */
  async incr(key: string, ttlMs: number): Promise<{ count: number; ttlMs: number }> {
    const ttl = Math.max(1, Math.round(ttlMs));
    return this.withRedis(
      async (r) => {
        const [count, left] = (await r.eval(INCR_WITH_TTL, 1, this.redis.key(key), ttl)) as [number, number];
        return { count: Number(count), ttlMs: Number(left) };
      },
      () => {
        const now = Date.now();
        const e = this.memGet(key);
        if (!e) {
          this.memSet(key, '1', ttl);
          return { count: 1, ttlMs: ttl };
        }
        const count = Number(e.value) + 1;
        e.value = String(count);
        return { count, ttlMs: e.expiresAt - now };
      },
    );
  }

  /** 剩余过期毫秒；不存在返回 -1 */
  async pttl(key: string): Promise<number> {
    return this.withRedis(
      async (r) => {
        const t = await r.pttl(this.redis.key(key));
        return t < 0 ? -1 : t;
      },
      () => {
        const e = this.memGet(key);
        return e ? e.expiresAt - Date.now() : -1;
      },
    );
  }

  /** 清理进程内存中的过期键，返回清理数量（Redis 键靠自身过期，无需清理） */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [k, e] of this.memory) {
      if (e.expiresAt <= now) {
        this.memory.delete(k);
        removed++;
      }
    }
    return removed;
  }

  // ---------- 内部实现 ----------

  /** 启用 Redis 时执行 redisOp，失败则告警并退回内存实现；未启用直接走内存 */
  private async withRedis<T>(redisOp: (r: NonNullable<RedisClientService['client']>) => Promise<T>, memOp: () => T): Promise<T> {
    const client = this.redis.client;
    if (!client) return memOp();
    try {
      return await redisOp(client);
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt > WARN_INTERVAL_MS) {
        this.lastWarnAt = now;
        this.logger.warn(`Redis 不可用，共享状态临时退回本机内存（多实例间暂不共享）: ${(e as Error).message}`);
      }
      return memOp();
    }
  }

  private memGet(key: string): MemoryEntry | undefined {
    const e = this.memory.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return e;
  }

  private memSet(key: string, value: string, ttlMs: number): void {
    // 容量上限：先清过期，仍超限则按写入顺序淘汰最早的（Map 迭代顺序即插入顺序）
    if (!this.memory.has(key) && this.memory.size >= MAX_MEMORY_KEYS) {
      this.sweep();
      for (const oldest of this.memory.keys()) {
        if (this.memory.size < MAX_MEMORY_KEYS) break;
        this.memory.delete(oldest);
      }
    }
    this.memory.delete(key); // 重新插入，保证淘汰顺序按最近写入
    this.memory.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisClientService } from '../redis/redis.module';

export type LockRelease = () => Promise<void>;

/**
 * 分布式锁抽象：
 * - LOCK_DRIVER=redis  Redis SET NX PX（多实例推荐；Redis 不可用时自动降级为 db）
 * - LOCK_DRIVER=db     数据库行锁降级（单机/无 Redis 场景，零外部依赖）
 *
 * 用法：
 *   const release = await lock.acquire('job:run:1', 30_000);
 *   if (!release) return; // 未抢到
 *   try { ... } finally { await release(); }
 */
@Injectable()
export class LockService {
  private readonly logger = new Logger(LockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisClients: RedisClientService,
  ) {}

  /**
   * 尝试获取锁；成功返回释放函数，失败(被占用)返回 null。
   */
  async acquire(key: string, ttlMs: number): Promise<LockRelease | null> {
    return this.redisClients.available ? this.acquireRedis(key, ttlMs) : this.acquireDb(key, ttlMs);
  }

  private async acquireRedis(key: string, ttlMs: number): Promise<LockRelease | null> {
    const redis = this.redisClients.client;
    if (!redis) return this.acquireDb(key, ttlMs);
    const owner = randomUUID();
    const redisKey = `lock:${key}`;
    let ok: string | null;
    try {
      ok = await redis.set(redisKey, owner, 'PX', ttlMs, 'NX');
    } catch (e) {
      // Redis 运行时故障：按"锁被占用"处理（调用方安全跳过本轮），而不是抛错或降级 db 锁——
      // 多实例下混用两种锁会破坏互斥性（A 实例持 redis 锁、B 实例走 db 锁，双双放行）
      this.logger.error(`Redis 获取锁失败，本次按占用处理(${key}): ${(e as Error).message}`);
      return null;
    }
    if (!ok) return null;
    return async () => {
      try {
        // 只释放自己持有的锁（Lua 保证原子性）
        await this.redisClients.client?.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          redisKey,
          owner,
        );
      } catch (e) {
        // 释放失败不影响业务，锁靠 TTL 自然过期
        this.logger.warn(`Redis 释放锁失败(将靠 TTL 过期): ${(e as Error).message}`);
      }
    };
  }

  private async acquireDb(key: string, ttlMs: number): Promise<LockRelease | null> {
    const owner = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);
    try {
      await this.prisma.sysLock.create({ data: { key, owner, expiresAt } });
    } catch {
      // 已存在：仅当已过期时抢占续期
      const stolen = await this.prisma.sysLock.updateMany({
        where: { key, expiresAt: { lt: new Date() } },
        data: { owner, expiresAt },
      });
      if (stolen.count === 0) return null;
    }
    return async () => {
      await this.prisma.sysLock.deleteMany({ where: { key, owner } });
    };
  }

  /** 清理过期锁记录（供示例定时任务调用） */
  async cleanupExpired(): Promise<number> {
    if (this.redisClients.available) return 0;
    const res = await this.prisma.sysLock.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return res.count;
  }
}

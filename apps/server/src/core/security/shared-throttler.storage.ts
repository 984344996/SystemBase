import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisClientService } from '../redis/redis-client.service';

/** Redis 故障告警的最小间隔 */
const WARN_INTERVAL_MS = 60_000;

/**
 * 固定窗口计数 + 超限封禁（原子执行）：
 *   KEYS[1] 计数键  KEYS[2] 封禁键  ARGV[1] 窗口毫秒  ARGV[2] 上限  ARGV[3] 封禁毫秒（<=0 表示封禁到窗口结束）
 *   返回 {计数, 窗口剩余毫秒, 封禁剩余毫秒(0 = 未封禁)}
 * 封禁期间不再计数；触发封禁时清空计数，封禁结束后重新开始（与 Nest 内置内存实现的语义一致）
 */
const INCREMENT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then return {tonumber(ARGV[2]) + 1, blockTtl, blockTtl} end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
if hits > tonumber(ARGV[2]) then
  local block = tonumber(ARGV[3])
  if block <= 0 then block = ttl end
  redis.call('SET', KEYS[2], '1', 'PX', block)
  redis.call('DEL', KEYS[1])
  return {hits, ttl, block}
end
return {hits, ttl, 0}`;

/**
 * 限流计数存储：
 * - LOCK_DRIVER=redis：计数放 Redis，多实例共享同一份额度（否则每台各算各的，实际上限 = 单台上限 × 实例数）
 * - 未启用 Redis：用 Nest 内置的进程内存实现
 * Redis 暂时不可用时退回本机内存计数并告警（限流失效比全站拒绝服务更可接受）
 */
export class SharedThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(SharedThrottlerStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private lastWarnAt = 0;

  constructor(private readonly redis: RedisClientService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const client = this.redis.client;
    if (!client) return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    try {
      const base = this.redis.key(`throttle:${throttlerName}:${key}`);
      const [hits, ttlMs, blockMs] = (await client.eval(INCREMENT, 2, `${base}:hits`, `${base}:block`, ttl, limit, blockDuration)) as [
        number,
        number,
        number,
      ];
      return {
        totalHits: Number(hits),
        timeToExpire: Math.ceil(Number(ttlMs) / 1000),
        isBlocked: Number(blockMs) > 0,
        timeToBlockExpire: Math.ceil(Number(blockMs) / 1000),
      };
    } catch (e) {
      const now = Date.now();
      if (now - this.lastWarnAt > WARN_INTERVAL_MS) {
        this.lastWarnAt = now;
        this.logger.warn(`Redis 不可用，限流计数临时退回本机内存（多实例间暂不共享）: ${(e as Error).message}`);
      }
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}

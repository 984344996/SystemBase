import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 连接统一管理（LOCK_DRIVER=redis 时启用）：
 * - 主连接：分布式锁、缓存等命令类用途，连接失败自动「视为不可用」（消费方自行降级）
 * - 附加连接：pub/sub 广播等需要独立连接的场景（Redis 订阅模式下不能发命令）
 *
 * 统一前的状态：LockService 与 PermissionCacheService 各自 new Redis，
 * 连接参数、重试策略、降级判断三处各写一套。
 */
@Injectable()
export class RedisClientService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisClientService.name);
  private readonly enabledByConfig: boolean;
  private readonly url: string;

  private main: Redis | null = null;
  private mainReady = false;

  constructor(config: ConfigService) {
    this.enabledByConfig = config.get<string>('LOCK_DRIVER') === 'redis';
    this.url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    if (!this.enabledByConfig) return;

    this.main = new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    this.main
      .connect()
      .then(() => {
        this.mainReady = true;
      })
      .catch((e) => {
        this.logger.error(`Redis 主连接失败，依赖 Redis 的能力将按各自策略降级: ${e.message}`);
      });
  }

  /** 配置是否启用了 Redis（LOCK_DRIVER=redis） */
  get enabled(): boolean {
    return this.enabledByConfig;
  }

  /** 主连接是否可用（连接成功后为 true；失败后消费方应降级，而不是让命令报错） */
  get available(): boolean {
    return this.enabledByConfig && this.mainReady && !!this.main;
  }

  /** 主连接（命令类用途）；不可用时返回 null，由调用方降级 */
  get client(): Redis | null {
    return this.available ? this.main : null;
  }

  /**
   * 附加连接（pub/sub 等）：未启用时返回 null，调用方据此关闭相关能力。
   * 只创建不连接：连接时机与失败处理由调用方决定（订阅类必须显式 connect + subscribe，
   * 命令类可交给 lazyConnect 在首次命令时自动连接，失败自行 catch 即完成降级）。
   */
  createConnection(): Redis | null {
    if (!this.enabledByConfig) return null;
    return new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.main?.quit().catch(() => undefined);
  }
}

@Global()
@Module({
  providers: [RedisClientService],
  exports: [RedisClientService],
})
export class RedisModule {}

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 连接统一管理（LOCK_DRIVER=redis 时启用）：
 * - 主连接：分布式锁、共享存储（验证码/登录失败计数/限流计数）等命令类用途
 * - 附加连接：pub/sub 广播等需要独立连接的场景（Redis 订阅模式下不能发命令）
 *
 * 「是否走 Redis」只由配置决定（LOCK_DRIVER），不随连接状态切换：
 * 多实例下如果一台连不上 Redis 就改用数据库锁/内存计数，会和其他实例各算各的（互斥失效）。
 * 连接暂时不可用时，命令会失败，由各消费方决定降级方式（锁按「被占用」处理、计数退回本机内存等）。
 *
 * 键名统一加前缀 REDIS_KEY_PREFIX（默认 sb:）：同一个 Redis 给多个环境/项目共用时互不干扰
 * （更推荐给每个环境用不同的库号，如 redis://127.0.0.1:6379/1）。
 */
@Injectable()
export class RedisClientService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisClientService.name);
  private readonly enabledByConfig: boolean;
  private readonly url: string;
  /** 键名前缀（如 sb:） */
  readonly prefix: string;

  private main: Redis | null = null;
  private ready = false;

  constructor(config: ConfigService) {
    this.enabledByConfig = config.get<string>('LOCK_DRIVER') === 'redis';
    this.url = config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.prefix = config.get<string>('REDIS_KEY_PREFIX') || 'sb:';
    if (!this.enabledByConfig) return;

    this.main = new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // 断开期间命令立即失败（不排队等重连）：否则 Redis 宕机时每个请求都要卡几秒才降级
      enableOfflineQueue: false,
      connectTimeout: 3000,
      // 断线后持续后台重连（最多每 5 秒一次）
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    // 连接状态跟踪：ready = 可执行命令；断开/重连中 = 不可用（健康检查与日志用）
    this.main.on('ready', () => {
      if (!this.ready) this.logger.log('Redis 已连接');
      this.ready = true;
    });
    this.main.on('end', () => (this.ready = false));
    this.main.on('close', () => (this.ready = false));
    this.main.on('error', () => undefined); // 错误由命令调用方处理；这里吞掉避免未处理 error 事件
    this.main.connect().catch((e) => {
      this.logger.error(`Redis 主连接失败，依赖 Redis 的能力将按各自策略降级（后台持续重连）: ${e.message}`);
    });
  }

  /** 配置是否启用了 Redis（LOCK_DRIVER=redis）——决定「走哪套实现」，不随连接状态变化 */
  get enabled(): boolean {
    return this.enabledByConfig;
  }

  /** 主连接当前是否可执行命令（仅用于健康检查与提示；不要用它来切换实现） */
  get available(): boolean {
    return this.enabledByConfig && this.ready && !!this.main;
  }

  /**
   * 主连接：启用 Redis 时始终返回连接对象（即使暂时断开——命令会失败或排队，由调用方 catch 处理）；
   * 未启用时返回 null
   */
  get client(): Redis | null {
    return this.main;
  }

  /** 加前缀后的键名 */
  key(name: string): string {
    return this.prefix + name;
  }

  /** 连通性探测（健康检查用）：返回 up / down，最多等待 timeoutMs */
  async ping(timeoutMs = 1000): Promise<'up' | 'down'> {
    if (!this.main) return 'down';
    try {
      const pong = await Promise.race([
        this.main.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  /**
   * 附加连接（pub/sub 等）：未启用时返回 null，调用方据此关闭相关能力。
   * 只创建不连接：连接时机与失败处理由调用方决定。
   */
  createConnection(): Redis | null {
    if (!this.enabledByConfig) return null;
    return new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 1000, 10_000),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.main?.quit().catch(() => undefined);
  }
}

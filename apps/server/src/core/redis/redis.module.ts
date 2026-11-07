import { Global, Module } from '@nestjs/common';
import { RedisClientService } from './redis-client.service';
import { EventBusService } from './event-bus.service';
import { SharedStoreService } from './shared-store.service';

// 兼容旧的引用路径：import { RedisClientService } from '../redis/redis.module'
export { RedisClientService };

/**
 * 全局模块：Redis 连接 + 基于它的两个通用能力
 * - SharedStoreService：带过期时间的共享键值存储（未启用 Redis 时为进程内存）
 * - EventBusService：跨实例事件广播（未启用 Redis 时只在本进程内分发）
 */
@Global()
@Module({
  providers: [RedisClientService, SharedStoreService, EventBusService],
  exports: [RedisClientService, SharedStoreService, EventBusService],
})
export class RedisModule {}

import { ConfigService } from '@nestjs/config';
import { RedisClientService } from './redis-client.service';
import { EventBusService } from './event-bus.service';
import { SharedStoreService } from './shared-store.service';

/**
 * 单测辅助：不连 Redis 的本地实现（等同 LOCK_DRIVER=db 时的行为）。
 *   - localEventBus()：事件只在本进程内分发
 *   - localStore()：共享存储落在进程内存
 * 业务代码不要引用本文件。
 */
const localRedis = () => new RedisClientService(new ConfigService({ LOCK_DRIVER: 'db' }));

export function localEventBus(): EventBusService {
  return new EventBusService(localRedis());
}

export function localStore(): SharedStoreService {
  return new SharedStoreService(localRedis());
}

import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '../redis/redis.module';
import { PermissionCacheService } from './permission-cache.service';
import type { AuthUser } from './jwt.strategy';

const user = (id: number, permissions: string[] = []): AuthUser => ({
  id,
  username: `u${id}`,
  name: `用户${id}`,
  roles: ['R'],
  permissions,
  mustChangePassword: false,
  pwdUpdatedAt: 0,
});

const create = (ttl = '30') => new PermissionCacheService(new ConfigService({ PERMISSION_CACHE_TTL: ttl }), new RedisClientService(new ConfigService({ LOCK_DRIVER: 'db' })));

describe('PermissionCacheService', () => {
  afterEach(() => jest.useRealTimers());

  it('TTL 内命中，过期后失效', () => {
    jest.useFakeTimers();
    const cache = create('30');
    cache.set(user(1, ['a']), cache.ticket(1));
    expect(cache.get(1)?.permissions).toEqual(['a']);
    jest.advanceTimersByTime(30_001);
    expect(cache.get(1)).toBeUndefined();
  });

  it('TTL=0 关闭缓存', () => {
    const cache = create('0');
    expect(cache.enabled).toBe(false);
    cache.set(user(1), cache.ticket(1));
    expect(cache.get(1)).toBeUndefined();
  });

  it('invalidateUser 只影响该用户', () => {
    const cache = create();
    cache.set(user(1), cache.ticket(1));
    cache.set(user(2), cache.ticket(2));
    cache.invalidateUser(1);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeDefined();
  });

  it('invalidateAll 清空全部', () => {
    const cache = create();
    cache.set(user(1), cache.ticket(1));
    cache.set(user(2), cache.ticket(2));
    cache.invalidateAll();
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeUndefined();
  });

  it('并发保护：查库期间发生失效，旧结果不会写回', () => {
    const cache = create();
    const t1 = cache.ticket(1); // 请求 A 开始查库
    cache.invalidateUser(1); // 管理员禁用该用户
    cache.set(user(1, ['stale']), t1); // 请求 A 带着旧数据返回
    expect(cache.get(1)).toBeUndefined();

    const t2 = cache.ticket(2);
    cache.invalidateAll(); // 角色授权变更
    cache.set(user(2, ['stale']), t2);
    expect(cache.get(2)).toBeUndefined();
  });
});

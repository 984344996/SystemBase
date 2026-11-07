/**
 * LOCK_DRIVER=redis 时的共享状态行为（用 ioredis-mock 模拟 Redis，支持 Lua 与 pub/sub）。
 * 多个服务实例共用同一个 mock 数据源，用来模拟「多台服务器连同一个 Redis」。
 */
jest.mock('ioredis', () => require('ioredis-mock'));

import { ConfigService } from '@nestjs/config';
import { RedisClientService } from './redis-client.service';
import { SharedStoreService } from './shared-store.service';
import { EventBusService } from './event-bus.service';
import { SharedThrottlerStorage } from '../security/shared-throttler.storage';
import { LockService } from '../lock/lock.service';

// @prisma/client 被导入时会把 apps/server/.env 加载进 process.env，而 ConfigService 优先读 process.env：
// 清掉本机开发配置里的 Redis 相关项，保证测试用的是下面传入的配置
for (const k of ['LOCK_DRIVER', 'REDIS_URL', 'REDIS_KEY_PREFIX']) delete process.env[k];

/** 新建一个「实例」的 Redis 客户端（mock 的数据在同一进程内共享） */
function redisClient(prefix = 'sb:') {
  return new RedisClientService(new ConfigService({ LOCK_DRIVER: 'redis', REDIS_URL: 'redis://mock:6379', REDIS_KEY_PREFIX: prefix }));
}

/** 等待 pub/sub 消息投递 */
const flush = () => new Promise((r) => setTimeout(r, 30));

const clients: RedisClientService[] = [];
const track = (c: RedisClientService) => (clients.push(c), c);

beforeEach(async () => {
  await track(redisClient()).client!.flushall();
});
afterAll(async () => {
  for (const c of clients) await c.onModuleDestroy();
});

describe('SharedStoreService（Redis 模式）', () => {
  it('读写、一次性读取、计数、删除；键名带前缀', async () => {
    const redis = track(redisClient());
    const store = new SharedStoreService(redis);
    expect(store.distributed).toBe(true);

    await store.set('a', 'v1', 60_000);
    expect(await store.get('a')).toBe('v1');
    expect(await redis.client!.get('sb:a')).toBe('v1'); // 实际键名带 REDIS_KEY_PREFIX

    expect(await store.take('a')).toBe('v1');
    expect(await store.take('a')).toBeNull(); // 一次性

    expect((await store.incr('n', 60_000)).count).toBe(1);
    const second = await store.incr('n', 60_000);
    expect(second.count).toBe(2);
    expect(second.ttlMs).toBeGreaterThan(0);
    expect(await store.pttl('n')).toBeGreaterThan(0);

    await store.del('n');
    expect(await store.get('n')).toBeNull();
    expect(await store.pttl('n')).toBe(-1);
  });

  it('两个实例看到同一份数据（多实例共享）', async () => {
    const a = new SharedStoreService(track(redisClient()));
    const b = new SharedStoreService(track(redisClient()));
    await a.incr('fail', 60_000);
    await b.incr('fail', 60_000);
    expect(await a.get('fail')).toBe('2');
  });

  it('不同前缀互相隔离（多个环境共用一个 Redis）', async () => {
    const pre = new SharedStoreService(track(redisClient('pre:')));
    const rel = new SharedStoreService(track(redisClient('rel:')));
    await pre.set('k', 'pre', 60_000);
    expect(await rel.get('k')).toBeNull();
  });

  it('Redis 命令失败时退回本机内存，不抛错', async () => {
    const redis = track(redisClient());
    const store = new SharedStoreService(redis);
    jest.spyOn(redis.client!, 'set').mockRejectedValueOnce(new Error('connection lost'));
    jest.spyOn(redis.client!, 'get').mockRejectedValueOnce(new Error('connection lost'));
    await expect(store.set('x', '1', 60_000)).resolves.toBeUndefined();
    expect(await store.get('x')).toBe('1'); // 从内存读到
  });
});

describe('SharedThrottlerStorage（Redis 模式）', () => {
  it('超过上限后封禁；多实例共享同一份额度', async () => {
    const a = new SharedThrottlerStorage(track(redisClient()));
    const b = new SharedThrottlerStorage(track(redisClient()));
    expect((await a.increment('ip1', 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
    expect((await b.increment('ip1', 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
    // 第 3 次（无论打到哪台实例）超过上限
    const third = await a.increment('ip1', 60_000, 2, 60_000, 'default');
    expect(third.isBlocked).toBe(true);
    expect(third.timeToBlockExpire).toBeGreaterThan(0);
    // 封禁期间继续被拒；其他 IP 不受影响
    expect((await b.increment('ip1', 60_000, 2, 60_000, 'default')).isBlocked).toBe(true);
    expect((await b.increment('ip2', 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
  });

  it('Redis 故障时退回内存计数，不阻断请求', async () => {
    const redis = track(redisClient());
    const storage = new SharedThrottlerStorage(redis);
    jest.spyOn(redis.client!, 'eval').mockRejectedValue(new Error('down'));
    const r = await storage.increment('ip', 60_000, 5, 0, 'default');
    expect(r).toMatchObject({ totalHits: 1, isBlocked: false });
  });
});

describe('EventBusService（Redis 模式）', () => {
  it('发布方本地立即处理一次；其他实例经 Redis 收到；不会重复处理自己的消息', async () => {
    const a = new EventBusService(track(redisClient()));
    const b = new EventBusService(track(redisClient()));
    a.onModuleInit();
    b.onModuleInit();
    await flush();
    const seenA: string[] = [];
    const seenB: string[] = [];
    a.subscribe('dict:invalidate', (p) => seenA.push(p));
    b.subscribe('dict:invalidate', (p) => seenB.push(p));

    a.publish('dict:invalidate', 'gender');
    expect(seenA).toEqual(['gender']); // 本地同步处理
    await flush();
    expect(seenB).toEqual(['gender']); // 其他实例收到
    expect(seenA).toEqual(['gender']); // 自己发的广播被忽略，没有处理第二次
    await a.onModuleDestroy();
    await b.onModuleDestroy();
  });
});

describe('LockService（Redis 模式）', () => {
  const prisma = { sysLock: { create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() } } as any;

  it('互斥：持有期间他人拿不到；释放后可再获取；不会退化为数据库锁', async () => {
    const lockA = new LockService(prisma, track(redisClient()));
    const lockB = new LockService(prisma, track(redisClient()));
    const release = await lockA.acquire('job:1', 60_000);
    expect(release).toBeTruthy();
    expect(await lockB.acquire('job:1', 60_000)).toBeNull();
    await release!();
    expect(await lockB.acquire('job:1', 60_000)).toBeTruthy();
    expect(prisma.sysLock.create).not.toHaveBeenCalled();
  });

  it('Redis 故障时按「被占用」处理（返回 null），而不是改用数据库锁', async () => {
    const redis = track(redisClient());
    const lock = new LockService(prisma, redis);
    jest.spyOn(redis.client!, 'set').mockRejectedValueOnce(new Error('down'));
    expect(await lock.acquire('job:2', 60_000)).toBeNull();
    expect(prisma.sysLock.create).not.toHaveBeenCalled();
  });
});

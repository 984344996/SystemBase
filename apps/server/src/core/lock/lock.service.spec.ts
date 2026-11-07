import { ConfigService } from '@nestjs/config';
import { LockService } from './lock.service';
import { RedisClientService } from '../redis/redis-client.service';

/** LOCK_DRIVER=db 时的数据库锁（Redis 模式见 core/redis/redis-shared.spec.ts） */
function setup() {
  const prisma = {
    sysLock: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
  };
  const lock = new LockService(prisma as any, new RedisClientService(new ConfigService({ LOCK_DRIVER: 'db' })));
  return { prisma, lock };
}

describe('LockService（数据库锁）', () => {
  it('插入成功即获得锁；释放时只删除自己持有的记录', async () => {
    const { lock, prisma } = setup();
    const release = await lock.acquire('job:1', 30_000);
    expect(release).toBeTruthy();
    const owner = prisma.sysLock.create.mock.calls[0][0].data.owner;
    await release!();
    expect(prisma.sysLock.deleteMany).toHaveBeenCalledWith({ where: { key: 'job:1', owner } });
  });

  it('已被占用且未过期：返回 null', async () => {
    const { lock, prisma } = setup();
    prisma.sysLock.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    prisma.sysLock.updateMany.mockResolvedValue({ count: 0 });
    expect(await lock.acquire('job:1', 30_000)).toBeNull();
  });

  it('已被占用但已过期：抢占成功', async () => {
    const { lock, prisma } = setup();
    prisma.sysLock.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    prisma.sysLock.updateMany.mockResolvedValue({ count: 1 });
    expect(await lock.acquire('job:1', 30_000)).toBeTruthy();
    // 只抢占已过期的记录
    expect(prisma.sysLock.updateMany.mock.calls[0][0].where).toMatchObject({ key: 'job:1', expiresAt: { lt: expect.any(Date) } });
  });

  it('cleanupExpired：删除过期记录并返回数量', async () => {
    const { lock } = setup();
    await expect(lock.cleanupExpired()).resolves.toBe(3);
  });
});

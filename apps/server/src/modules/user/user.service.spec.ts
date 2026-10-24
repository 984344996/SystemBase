import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '../../core/redis/redis.module';
import * as bcrypt from 'bcryptjs';
import { UserService } from './user.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionCacheService } from '../../core/security/permission-cache.service';
import { PrivilegeGuardService } from '../../core/security/privilege-guard.service';
import { AuthUser } from '../../core/security/jwt.strategy';

const SUPER: AuthUser = { id: 1, username: 'admin', name: '管理员', roles: ['SUPER_ADMIN'], permissions: [], mustChangePassword: false, pwdUpdatedAt: 0 };
const OPERATOR: AuthUser = {
  id: 2,
  username: 'ops',
  name: '运营',
  roles: ['OPS'],
  permissions: ['system:user:list', 'system:user:update'],
  mustChangePassword: false,
  pwdUpdatedAt: 0,
};

function setup(userOverrides: Record<string, unknown> = {}) {
  const user = {
    id: 5,
    username: 'tom',
    name: '汤姆',
    password: bcrypt.hashSync('admin123', 4),
    status: 'ENABLED',
    deletedAt: null,
    ...userOverrides,
  };
  const prisma: any = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    userRole: { findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn(), createMany: jest.fn() },
    role: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // 同时支持「回调形式」与「数组形式」两种 $transaction 用法（tx 直接用同一个 mock）
  prisma.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const permCache = new PermissionCacheService(
    new ConfigService({ PERMISSION_CACHE_TTL: '30' }),
    new RedisClientService(new ConfigService({ LOCK_DRIVER: 'db' })),
  );
  const invalidateUser = jest.spyOn(permCache, 'invalidateUser');
  const privilege = new PrivilegeGuardService(prisma as unknown as PrismaService);
  const service = new UserService(prisma as unknown as PrismaService, permCache, privilege);
  return { service, prisma, user, permCache, invalidateUser };
}

describe('UserService.create', () => {
  it('用户名重复 → 400', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.create({ username: 'tom', password: 'Sb#2026demoX', name: 'x' }, SUPER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('并发撞唯一约束(P2002) → 业务码 40901（HTTP 409）而非 500', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ username: 'new', password: 'Sb#2026demoX', name: 'x' }, SUPER)).rejects.toMatchObject({
      status: 409,
      response: { bizCode: 40901 },
    });
  });

  it('创建成功：密码存哈希、明文不落库', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 9, ...data }));
    await service.create({ username: 'new', password: 'Sb#2026demoX', name: '新人' }, SUPER);
    // 输出走 USER_SELECT（不含 password），故断言写入参数：入库的是哈希而非明文
    const arg = prisma.user.create.mock.calls[0][0];
    expect(arg.data.password).not.toBe('Sb#2026demoX');
    expect(await bcrypt.compare('Sb#2026demoX', arg.data.password)).toBe(true);
  });

  it('非超管不能授予超管角色 → 403（业务码 40302）', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findMany.mockResolvedValue([{ id: 100, code: 'SUPER_ADMIN', name: '超级管理员', menus: [] }]);
    await expect(
      service.create({ username: 'new', password: 'Sb#2026demoX', name: 'x', roleIds: [100] }, OPERATOR),
    ).rejects.toMatchObject({ status: 403, response: { bizCode: 40302 } });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('非超管不能授予超出自身权限的角色 → 403', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findMany.mockResolvedValue([
      { id: 7, code: 'HR', name: '人事', menus: [{ menu: { permission: 'system:user:delete' } }] },
    ]);
    await expect(
      service.create({ username: 'new', password: 'Sb#2026demoX', name: 'x', roleIds: [7] }, OPERATOR),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('角色不存在 → 400（而非外键报错 500）', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.count.mockResolvedValue(0);
    await expect(
      service.create({ username: 'new', password: 'Sb#2026demoX', name: 'x', roleIds: [999] }, SUPER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UserService.update', () => {
  it('更新不存在的用户 → 404', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x' }, SUPER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('状态/角色变更后触发权限缓存失效（立即生效）', async () => {
    const { service, prisma, user, invalidateUser } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue(null); // 无超管角色，不触发保护逻辑
    await service.update(5, { name: '新名字', status: 'DISABLED' }, SUPER);
    expect(invalidateUser).toHaveBeenCalledWith(5);
  });

  it('不允许禁用最后一个启用的超管（事务内加锁判断）', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue({ id: 100, code: 'SUPER_ADMIN' });
    prisma.$queryRaw.mockResolvedValue([{ userId: 5 }]); // 目标是唯一启用的超管
    await expect(service.update(5, { name: 'x', status: 'DISABLED' }, SUPER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('还有其他启用的超管时允许禁用', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue({ id: 100, code: 'SUPER_ADMIN' });
    prisma.$queryRaw.mockResolvedValue([{ userId: 5 }, { userId: 1 }]);
    await expect(service.update(5, { name: 'x', status: 'DISABLED' }, SUPER)).resolves.toBeDefined();
  });

  it('非超管不能修改超管账号 → 403', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.userRole.count.mockResolvedValue(1); // 目标是超管
    await expect(service.update(5, { name: 'x' }, OPERATOR)).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('UserService.remove', () => {
  it('软删除 + 吊销 refreshToken + 缓存失效', async () => {
    const { service, prisma, user, invalidateUser } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue(user);
    await expect(service.remove(5, SUPER)).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(invalidateUser).toHaveBeenCalledWith(5);
  });

  it('不能删除自己', async () => {
    const { service, prisma, user } = setup({ id: 1 });
    prisma.user.findFirst.mockResolvedValue(user);
    await expect(service.remove(1, SUPER)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UserService.resetPassword', () => {
  it('弱密码被密码策略拒绝', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    await expect(service.resetPassword(5, 'admin123', SUPER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('合规密码：写入哈希、置 mustChangePassword、更新 pwdUpdatedAt 并吊销登录态', async () => {
    const { service, prisma, user, invalidateUser } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);
    await service.resetPassword(5, 'Sb#2026demoX', SUPER);
    const arg = prisma.user.update.mock.calls[0][0];
    expect(arg.data.mustChangePassword).toBe(true);
    expect(arg.data.pwdUpdatedAt).toBeInstanceOf(Date);
    expect(await bcrypt.compare('Sb#2026demoX', arg.data.password)).toBe(true);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(invalidateUser).toHaveBeenCalledWith(5); // 旧 accessToken 立即失效
  });

  it('非超管不能重置超管密码（防接管）→ 403', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.userRole.count.mockResolvedValue(1);
    await expect(service.resetPassword(5, 'Sb#2026demoX', OPERATOR)).rejects.toMatchObject({ status: 403 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

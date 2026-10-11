import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { UserService } from './user.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionCacheService } from '../../core/security/permission-cache.service';

function setup(userOverrides: Record<string, unknown> = {}) {
  const user = {
    id: 1,
    username: 'admin',
    name: '管理员',
    password: bcrypt.hashSync('admin123', 4),
    status: 'ENABLED',
    deletedAt: null,
    ...userOverrides,
  };
  const prisma: any = {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    userRole: { findFirst: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    role: { findUnique: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
  };
  // 同时支持「回调形式」与「数组形式」两种 $transaction 用法（tx 直接用同一个 mock）
  prisma.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const permCache = new PermissionCacheService(new ConfigService({ PERMISSION_CACHE_TTL: '30' }));
  const invalidateUser = jest.spyOn(permCache, 'invalidateUser');
  const service = new UserService(prisma as unknown as PrismaService, permCache);
  return { service, prisma, user, permCache, invalidateUser };
}

describe('UserService.create', () => {
  it('用户名重复 → 400', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.create({ username: 'admin', password: 'Sb#2026demoX', name: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('并发撞唯一约束(P2002) → 转 400 而非 500', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ username: 'new', password: 'Sb#2026demoX', name: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('创建成功：密码存哈希、明文不落库', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 9, ...data }));
    await service.create({ username: 'new', password: 'Sb#2026demoX', name: '新人' });
    // 输出走 USER_SELECT（不含 password），故断言写入参数：入库的是哈希而非明文
    const arg = prisma.user.create.mock.calls[0][0];
    expect(arg.data.password).not.toBe('Sb#2026demoX');
    expect(await bcrypt.compare('Sb#2026demoX', arg.data.password)).toBe(true);
  });
});

describe('UserService.update', () => {
  it('更新不存在的用户 → 404', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('状态/角色变更后触发权限缓存失效（立即生效）', async () => {
    const { service, prisma, user, invalidateUser } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue(null); // 非超管，不触发保护逻辑
    await service.update(1, { name: '新名字', status: 'DISABLED' });
    expect(invalidateUser).toHaveBeenCalledWith(1);
  });

  it('不允许禁用最后一个启用的超管', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue({ id: 100, code: 'SUPER_ADMIN' });
    prisma.userRole.findFirst.mockResolvedValue({ userId: 1, roleId: 100 });
    prisma.userRole.count.mockResolvedValue(0); // 没有其他启用的超管
    await expect(service.update(1, { name: '管理员', status: 'DISABLED' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('UserService.remove', () => {
  it('软删除 + 吊销 refreshToken + 缓存失效', async () => {
    const { service, prisma, user, invalidateUser } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue(user);
    await expect(service.remove(1)).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    expect(invalidateUser).toHaveBeenCalledWith(1);
  });
});

describe('UserService.resetPassword', () => {
  it('弱密码被密码策略拒绝', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    await expect(service.resetPassword(1, 'admin123')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('合规密码：写入哈希、置 mustChangePassword 并吊销登录态', async () => {
    const { service, prisma, user } = setup();
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue(user);
    await service.resetPassword(1, 'Sb#2026demoX');
    const arg = prisma.user.update.mock.calls[0][0];
    expect(arg.data.mustChangePassword).toBe(true);
    expect(await bcrypt.compare('Sb#2026demoX', arg.data.password)).toBe(true);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });
});

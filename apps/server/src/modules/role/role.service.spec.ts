import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '../../core/redis/redis.module';
import { RoleService } from './role.service';
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
  permissions: ['system:role:update', 'system:user:list'],
  mustChangePassword: false,
  pwdUpdatedAt: 0,
};

function setup() {
  const prisma: any = {
    role: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    roleMenu: { deleteMany: jest.fn(), createMany: jest.fn() },
    userRole: { count: jest.fn().mockResolvedValue(0), deleteMany: jest.fn() },
    menu: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const permCache = new PermissionCacheService(
    new ConfigService({ PERMISSION_CACHE_TTL: '30' }),
    new RedisClientService(new ConfigService({ LOCK_DRIVER: 'db' })),
  );
  const invalidateAll = jest.spyOn(permCache, 'invalidateAll');
  const privilege = new PrivilegeGuardService(prisma as unknown as PrismaService);
  const service = new RoleService(prisma as unknown as PrismaService, permCache, privilege);
  return { service, prisma, permCache, invalidateAll };
}

describe('RoleService.create', () => {
  it('编码重复 → 400', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 1, code: 'OPS' });
    await expect(service.create({ code: 'OPS', name: '运营' }, SUPER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('并发撞唯一约束 → 业务码 40901（HTTP 409）而非 500', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.role.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ code: 'OPS', name: '运营' }, SUPER)).rejects.toMatchObject({
      status: 409,
      response: { bizCode: 40901 },
    });
  });

  it('带菜单授权创建：写入 roleMenu', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.menu.count.mockResolvedValue(2);
    prisma.role.create.mockResolvedValue({ id: 2, code: 'OPS' });
    await service.create({ code: 'OPS', name: '运营', menuIds: [10, 11] }, SUPER);
    expect(prisma.role.create.mock.calls[0][0].data.menus.create).toEqual([{ menuId: 10 }, { menuId: 11 }]);
  });

  it('菜单不存在 → 400（而非外键报错 500）', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.menu.count.mockResolvedValue(1);
    await expect(service.create({ code: 'OPS', name: '运营', menuIds: [10, 999] }, SUPER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('RoleService.update', () => {
  it('角色不存在 → 404', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x' }, SUPER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('内置超管角色不允许禁用', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 1, code: 'SUPER_ADMIN' });
    await expect(service.update(1, { name: '超管', status: 'DISABLED' }, SUPER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('授权变更后全量失效权限缓存（影响该角色下所有用户）', async () => {
    const { service, prisma, invalidateAll } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 3, code: 'OPS' });
    prisma.role.update.mockResolvedValue({ id: 3 });
    await service.update(3, { name: '运营', menuIds: [] }, SUPER);
    expect(prisma.roleMenu.deleteMany).toHaveBeenCalledWith({ where: { roleId: 3 } });
    expect(invalidateAll).toHaveBeenCalled();
  });

  it('非超管不能修改自己所属角色的授权 → 403', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 3, code: 'OPS' });
    prisma.userRole.count.mockResolvedValue(1); // 操作者属于该角色
    await expect(service.update(3, { name: '运营', menuIds: [] }, OPERATOR)).rejects.toMatchObject({ status: 403 });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('非超管不能授予自己不具备的权限 → 403', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 4, code: 'HR' });
    prisma.menu.findMany.mockResolvedValue([{ permission: 'system:user:delete' }]);
    await expect(service.update(4, { name: '人事', menuIds: [20] }, OPERATOR)).rejects.toMatchObject({ status: 403 });
  });
});

describe('RoleService.remove', () => {
  it('内置超管角色不允许删除', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 1, code: 'SUPER_ADMIN', _count: { users: 0 } });
    await expect(service.remove(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('角色下仍有用户 → 拒绝删除', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 3, code: 'OPS', _count: { users: 2 } });
    await expect(service.remove(3)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('无有效用户引用可删除（连带清理已删除用户的关联）并失效缓存', async () => {
    const { service, prisma, invalidateAll } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 3, code: 'OPS', _count: { users: 0 } });
    await expect(service.remove(3)).resolves.toEqual({ success: true });
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { roleId: 3 } });
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(invalidateAll).toHaveBeenCalled();
  });
});

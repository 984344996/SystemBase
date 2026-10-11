import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleService } from './role.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionCacheService } from '../../core/security/permission-cache.service';

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
  };
  prisma.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const permCache = new PermissionCacheService(new ConfigService({ PERMISSION_CACHE_TTL: '30' }));
  const invalidateAll = jest.spyOn(permCache, 'invalidateAll');
  const service = new RoleService(prisma as unknown as PrismaService, permCache);
  return { service, prisma, permCache, invalidateAll };
}

describe('RoleService.create', () => {
  it('编码重复 → 400', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 1, code: 'OPS' });
    await expect(service.create({ code: 'OPS', name: '运营' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('并发撞唯一约束 → 400 而非 500', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.role.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ code: 'OPS', name: '运营' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('带菜单授权创建：写入 roleMenu', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 2, code: 'OPS' });
    await service.create({ code: 'OPS', name: '运营', menuIds: [10, 11] });
    expect(prisma.role.create.mock.calls[0][0].data.menus.create).toEqual([{ menuId: 10 }, { menuId: 11 }]);
  });
});

describe('RoleService.update', () => {
  it('角色不存在 → 404', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('内置超管角色不允许禁用', async () => {
    const { service, prisma } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 1, code: 'SUPER_ADMIN' });
    await expect(service.update(1, { name: '超管', status: 'DISABLED' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('授权变更后全量失效权限缓存（影响该角色下所有用户）', async () => {
    const { service, prisma, invalidateAll } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 3, code: 'OPS' });
    prisma.role.update.mockResolvedValue({ id: 3 });
    await service.update(3, { name: '运营', menuIds: [] });
    expect(prisma.roleMenu.deleteMany).toHaveBeenCalledWith({ where: { roleId: 3 } });
    expect(invalidateAll).toHaveBeenCalled();
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

  it('无用户引用可删除并失效缓存', async () => {
    const { service, prisma, invalidateAll } = setup();
    prisma.role.findUnique.mockResolvedValue({ id: 3, code: 'OPS', _count: { users: 0 } });
    await expect(service.remove(3)).resolves.toEqual({ success: true });
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(invalidateAll).toHaveBeenCalled();
  });
});

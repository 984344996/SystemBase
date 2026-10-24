import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisClientService } from '../../core/redis/redis.module';
import { MenuService } from './menu.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PermissionCacheService } from '../../core/security/permission-cache.service';

function setup() {
  const prisma: any = {
    menu: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    roleMenu: { deleteMany: jest.fn() },
  };
  prisma.$transaction = jest.fn((arg: any) => Promise.all(arg));
  const permCache = new PermissionCacheService(new ConfigService({ PERMISSION_CACHE_TTL: '30' }), new RedisClientService(new ConfigService({ LOCK_DRIVER: 'db' })));
  const invalidateAll = jest.spyOn(permCache, 'invalidateAll');
  const service = new MenuService(prisma as unknown as PrismaService, permCache);
  return { service, prisma, invalidateAll };
}

describe('MenuService.tree', () => {
  it('按 parentId 组装树，孤儿节点（父不存在）作为根', async () => {
    const { service, prisma } = setup();
    prisma.menu.findMany.mockResolvedValue([
      { id: 1, parentId: 0, name: '系统管理', type: 'DIRECTORY' },
      { id: 2, parentId: 1, name: '用户管理', type: 'MENU' },
      { id: 3, parentId: 999, name: '孤儿', type: 'MENU' },
    ]);
    const tree = await service.tree();
    const system = tree.find((n: any) => n.id === 1)!;
    expect(system.children.map((c: any) => c.id)).toEqual([2]);
    expect(tree.map((n: any) => n.id)).toContain(3); // 父不存在 → 根级
  });
});

describe('MenuService.create', () => {
  it('页面菜单缺 path/component → 400', async () => {
    const { service } = setup();
    await expect(service.create({ name: '页面', type: 'MENU' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('按钮缺权限码 → 400', async () => {
    const { service } = setup();
    await expect(service.create({ name: '新增', type: 'BUTTON' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('父级不存在 → 400；父级不是目录 → 400', async () => {
    const { service, prisma } = setup();
    prisma.menu.findUnique.mockResolvedValue(null);
    await expect(service.create({ name: 'x', type: 'MENU', path: '/x', component: 'x/X', parentId: 9 } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.menu.findUnique.mockResolvedValue({ id: 5, type: 'MENU' });
    await expect(service.create({ name: 'x', type: 'MENU', path: '/x', component: 'x/X', parentId: 5 } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('建在目录下：正常创建', async () => {
    const { service, prisma } = setup();
    prisma.menu.findUnique.mockResolvedValue({ id: 1, type: 'DIRECTORY' });
    prisma.menu.create.mockResolvedValue({ id: 10 });
    await expect(service.create({ name: '字典', type: 'MENU', path: '/dict', component: 'dict/Dict', parentId: 1 } as any)).resolves.toEqual({ id: 10 });
  });
});

describe('MenuService.update', () => {
  it('菜单不存在 → 404', async () => {
    const { service, prisma } = setup();
    prisma.menu.findUnique.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x', type: 'DIRECTORY' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('父级不能是自己', async () => {
    const { service, prisma } = setup();
    prisma.menu.findUnique.mockResolvedValue({ id: 1 });
    await expect(service.update(1, { name: 'x', type: 'DIRECTORY', parentId: 1 } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('循环引用（A→B→A）→ 400', async () => {
    const { service, prisma } = setup();
    // 1 的父设为 2；2 的父是 1 → 成环
    prisma.menu.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 1 ? { id: 1, parentId: 2 } : { id: 2, parentId: 1 }),
    );
    await expect(service.update(1, { name: 'x', type: 'DIRECTORY', parentId: 2 } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('更新成功：失效权限缓存', async () => {
    const { service, prisma, invalidateAll } = setup();
    prisma.menu.findUnique.mockResolvedValue({ id: 1, parentId: null });
    prisma.menu.update.mockResolvedValue({ id: 1 });
    await service.update(1, { name: '改名', type: 'DIRECTORY' } as any);
    expect(invalidateAll).toHaveBeenCalled();
  });
});

describe('MenuService.remove', () => {
  it('存在子菜单 → 拒绝删除', async () => {
    const { service, prisma } = setup();
    prisma.menu.findUnique.mockResolvedValue({ id: 1 });
    prisma.menu.count.mockResolvedValue(2);
    await expect(service.remove(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.menu.delete).not.toHaveBeenCalled();
  });

  it('无子菜单：事务清理 roleMenu 后删除，并失效缓存', async () => {
    const { service, prisma, invalidateAll } = setup();
    prisma.menu.findUnique.mockResolvedValue({ id: 1 });
    prisma.menu.count.mockResolvedValue(0);
    prisma.menu.delete.mockResolvedValue({ id: 1 });
    await expect(service.remove(1)).resolves.toEqual({ success: true });
    expect(prisma.roleMenu.deleteMany).toHaveBeenCalledWith({ where: { menuId: 1 } });
    expect(invalidateAll).toHaveBeenCalled();
  });
});

import { HttpException } from '@nestjs/common';
import { PrivilegeGuardService } from './privilege-guard.service';
import { SUPER_ROLE } from './permissions.guard';
import { BizCode } from '../filter/business.exception';
import type { AuthUser } from './jwt.strategy';

/** 构造操作者 */
const user = (roles: string[], permissions: string[], id = 10): AuthUser => ({
  id,
  username: `u${id}`,
  name: `用户${id}`,
  roles,
  permissions,
  mustChangePassword: false,
  pwdUpdatedAt: 0,
});
const superAdmin = user([SUPER_ROLE], [], 1);
const userAdmin = user(['user_admin'], ['system:user:list', 'system:user:update', 'system:role:list']);

function setup() {
  const prisma = {
    userRole: { count: jest.fn().mockResolvedValue(0) },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    menu: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, guard: new PrivilegeGuardService(prisma as any) };
}

/** 断言抛出 403 + 业务码 40302 */
async function expectDenied(p: Promise<unknown>, msg: RegExp) {
  const e = await p.catch((err) => err);
  expect(e).toBeInstanceOf(HttpException);
  expect((e as HttpException).getStatus()).toBe(403);
  expect((e as HttpException).getResponse()).toMatchObject({ bizCode: BizCode.PRIVILEGE_ESCALATION });
  expect((e as HttpException).message).toMatch(msg);
}

describe('PrivilegeGuardService.assertCanManageUser', () => {
  it('超管可以管理任何账号（不查库）', async () => {
    const { guard, prisma } = setup();
    await expect(guard.assertCanManageUser(superAdmin, 1)).resolves.toBeUndefined();
    expect(prisma.userRole.count).not.toHaveBeenCalled();
  });

  it('非超管不能管理超管账号', async () => {
    const { guard, prisma } = setup();
    prisma.userRole.count.mockResolvedValue(1);
    await expectDenied(guard.assertCanManageUser(userAdmin, 1), /超级管理员账号/);
  });

  it('非超管可以管理普通账号', async () => {
    const { guard } = setup();
    await expect(guard.assertCanManageUser(userAdmin, 99)).resolves.toBeUndefined();
  });
});

describe('PrivilegeGuardService.assertCanAssignRoles', () => {
  it('不分配角色时直接放行', async () => {
    const { guard, prisma } = setup();
    await expect(guard.assertCanAssignRoles(userAdmin, [])).resolves.toBeUndefined();
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('非超管不能授予超管角色', async () => {
    const { guard, prisma } = setup();
    prisma.role.findMany.mockResolvedValue([{ code: SUPER_ROLE, name: '超管', menus: [] }]);
    await expectDenied(guard.assertCanAssignRoles(userAdmin, [1]), /超级管理员角色/);
  });

  it('非超管不能授予包含自己没有的权限的角色（防提权）', async () => {
    const { guard, prisma } = setup();
    prisma.role.findMany.mockResolvedValue([
      { code: 'ops', name: '运维', menus: [{ menu: { permission: 'system:user:list' } }, { menu: { permission: 'system:job:run' } }] },
    ]);
    await expectDenied(guard.assertCanAssignRoles(userAdmin, [2]), /system:job:run/);
  });

  it('角色权限是自身权限的子集时放行（目录等无权限码的菜单不限制）', async () => {
    const { guard, prisma } = setup();
    prisma.role.findMany.mockResolvedValue([
      { code: 'viewer', name: '只读', menus: [{ menu: { permission: 'system:user:list' } }, { menu: { permission: null } }] },
    ]);
    await expect(guard.assertCanAssignRoles(userAdmin, [3])).resolves.toBeUndefined();
  });
});

describe('PrivilegeGuardService.assertCanEditRole', () => {
  it('非超管不能修改自己所属角色的授权', async () => {
    const { guard, prisma } = setup();
    prisma.userRole.count.mockResolvedValue(1);
    await expectDenied(guard.assertCanEditRole(userAdmin, 5, [1]), /自己所属角色/);
  });

  it('非超管不能把自己没有的权限授给角色', async () => {
    const { guard, prisma } = setup();
    prisma.menu.findMany.mockResolvedValue([{ permission: 'system:role:delete' }]);
    await expectDenied(guard.assertCanEditRole(userAdmin, 6, [9]), /system:role:delete/);
  });

  it('新建角色（roleId=null）且权限在自身范围内：放行', async () => {
    const { guard, prisma } = setup();
    prisma.menu.findMany.mockResolvedValue([{ permission: 'system:user:list' }, { permission: null }]);
    await expect(guard.assertCanEditRole(userAdmin, null, [1, 2])).resolves.toBeUndefined();
    expect(prisma.userRole.count).not.toHaveBeenCalled();
  });

  it('超管不受限制', async () => {
    const { guard, prisma } = setup();
    await expect(guard.assertCanEditRole(superAdmin, 5, [1])).resolves.toBeUndefined();
    expect(prisma.menu.findMany).not.toHaveBeenCalled();
  });
});

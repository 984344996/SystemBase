import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BizCode, BusinessException } from '../filter/business.exception';
import { AuthUser } from './jwt.strategy';
import { SUPER_ROLE, isSuperAdmin } from './permissions.guard';

const deny = (message: string) => new BusinessException(BizCode.PRIVILEGE_ESCALATION, message, HttpStatus.FORBIDDEN);

/**
 * 授权边界校验（防提权）：权限守卫只判断「有没有这个操作的权限码」，
 * 这里判断「授出去的东西是否超出操作者自己的范围」。超管不受限制。
 *
 * 规则：
 *   - 只有超管能授予/摘除超管角色、能修改/重置/删除超管账号
 *   - 非超管给用户分配的角色，其权限集合必须是操作者自身权限的子集
 *   - 非超管给角色授权的菜单，其权限码必须是操作者自身权限的子集（无权限码的目录/页面不限制）
 *   - 非超管不能修改自己所属角色的授权（否则可以先给自己的角色加权限再用）
 */
@Injectable()
export class PrivilegeGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /** 操作目标用户（改资料/改角色/重置密码/删除）前调用 */
  async assertCanManageUser(operator: AuthUser, targetUserId: number): Promise<void> {
    if (isSuperAdmin(operator)) return;
    const targetIsSuper = await this.prisma.userRole.count({
      where: { userId: targetUserId, role: { code: SUPER_ROLE } },
    });
    if (targetIsSuper) throw deny('只有超级管理员可以管理超级管理员账号');
  }

  /** 给用户分配角色前调用 */
  async assertCanAssignRoles(operator: AuthUser, roleIds: number[] | undefined): Promise<void> {
    if (!roleIds?.length || isSuperAdmin(operator)) return;
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      include: { menus: { include: { menu: { select: { permission: true } } } } },
    });
    if (roles.some((r) => r.code === SUPER_ROLE)) throw deny('只有超级管理员可以授予超级管理员角色');
    const own = new Set(operator.permissions);
    for (const role of roles) {
      const extra = role.menus.map((m) => m.menu.permission).filter((p): p is string => !!p && !own.has(p));
      if (extra.length) throw deny(`角色「${role.name}」包含你不具备的权限（${extra.slice(0, 3).join('、')}…），无法授予`);
    }
  }

  /** 修改角色（含菜单授权）前调用 */
  async assertCanEditRole(operator: AuthUser, roleId: number | null, menuIds: number[] | undefined): Promise<void> {
    if (isSuperAdmin(operator)) return;
    if (roleId !== null) {
      const own = await this.prisma.userRole.count({ where: { userId: operator.id, roleId } });
      if (own) throw deny('不能修改自己所属角色的授权');
    }
    if (!menuIds?.length) return;
    const menus = await this.prisma.menu.findMany({ where: { id: { in: menuIds } }, select: { permission: true } });
    const ownPerms = new Set(operator.permissions);
    const extra = menus.map((m) => m.permission).filter((p): p is string => !!p && !ownPerms.has(p));
    if (extra.length) throw deny(`不能授予你自己不具备的权限（${extra.slice(0, 3).join('、')}…）`);
  }
}

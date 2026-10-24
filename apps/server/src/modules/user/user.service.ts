import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { paginate } from '../../core/pagination/paginate';
import { PermissionCacheService } from '../../core/security/permission-cache.service';
import { PrivilegeGuardService } from '../../core/security/privilege-guard.service';
import { SUPER_ROLE } from '../../core/security/permissions.guard';
import { AuthUser } from '../../core/security/jwt.strategy';
import { assertPasswordUsable } from '../auth/auth.service';
import { CreateUserDto, QueryUserDto, UpdateUserDto } from './user.dto';

/**
 * 对外输出字段：显式 select，绝不含 password 哈希。
 * （include 会带上全部标量字段，密码哈希会随之泄露给前端）
 */
const USER_SELECT = {
  id: true,
  username: true,
  name: true,
  phone: true,
  email: true,
  status: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
  roles: { include: { role: { select: { id: true, code: true, name: true } } } },
};

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permCache: PermissionCacheService,
    private readonly privilege: PrivilegeGuardService,
  ) {}

  async list(query: QueryUserDto) {
    return paginate(this.prisma, this.prisma.user, {
      where: {
        deletedAt: null,
        ...(query.keyword
          ? { OR: [{ username: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      sortable: ['id', 'username', 'name', 'status', 'createdAt'],
      select: USER_SELECT,
    });
  }

  async create(dto: CreateUserDto, operator: AuthUser) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) {
      throw new BadRequestException(
        exists.deletedAt ? `用户名「${dto.username}」曾被已删除的账号使用，请换一个` : `用户名「${dto.username}」已存在`,
      );
    }
    const { roleIds, password, ...data } = dto;
    await assertPasswordUsable(password, dto.username); // 初始密码同样走密码策略（DTO 只校验了长度≥6）
    await this.privilege.assertCanAssignRoles(operator, roleIds);
    await this.assertRolesExist(roleIds);
    // 并发竞态兜底：查重通过但另一请求抢先写入，撞唯一约束(P2002)时转友好提示而非 500
    return withUniqueViolation(
      async () =>
        this.prisma.user.create({
          data: {
            ...data,
            password: await bcrypt.hash(password, 10),
            ...(roleIds?.length
              ? { roles: { create: roleIds.map((roleId) => ({ roleId })) } }
              : {}),
          },
          select: USER_SELECT,
        }),
      `用户名「${dto.username}」已存在`,
    );
  }

  async update(id: number, dto: UpdateUserDto, operator: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    await this.privilege.assertCanManageUser(operator, id);
    const { roleIds, ...data } = dto;
    await this.privilege.assertCanAssignRoles(operator, roleIds);
    await this.assertRolesExist(roleIds);
    const updated = await this.prisma.$transaction(async (tx) => {
      // 最后一个启用的超管不允许被禁用/摘除超管角色：检查放在事务内并加行锁，防两人同时互相禁用
      if (data.status === 'DISABLED' || roleIds) {
        await this.assertNotLastSuperAdmin(tx, id, { disable: data.status === 'DISABLED', newRoleIds: roleIds });
      }
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        if (roleIds.length) {
          await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
        }
      }
      return tx.user.update({ where: { id }, data, select: USER_SELECT });
    });
    this.permCache.invalidateUser(id); // 状态/角色/姓名变更立即生效
    return updated;
  }

  /** 软删除 */
  async remove(id: number, operator: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    if (id === operator.id) throw new BadRequestException('不能删除自己的账号');
    await this.privilege.assertCanManageUser(operator, id);
    await this.prisma.$transaction(async (tx) => {
      await this.assertNotLastSuperAdmin(tx, id, { disable: true });
      await tx.user.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.revokeAllRefreshTokens(tx, id);
    });
    this.permCache.invalidateUser(id); // 已删除用户的 accessToken 立即失效
    return { success: true };
  }

  async resetPassword(id: number, newPassword: string, operator: AuthUser) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    await this.privilege.assertCanManageUser(operator, id); // 非超管不能重置超管密码（防接管）
    await assertPasswordUsable(newPassword, user.username, user.password);
    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          password: hash,
          // 管理员重置的密码是临时密码，登录后强制改密
          mustChangePassword: true,
          pwdUpdatedAt: new Date(), // 早于此时间签发的 accessToken 立即失效（见 JwtStrategy）
        },
      });
      await this.revokeAllRefreshTokens(tx, id); // 重置密码后旧登录态全部失效
    });
    this.permCache.invalidateUser(id);
    return { success: true };
  }

  // ---------- 内部 ----------

  /** 吊销该用户全部未作废的 refreshToken（全端下线） */
  private revokeAllRefreshTokens(tx: Prisma.TransactionClient, userId: number) {
    return tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** 角色 id 必须存在（否则外键约束报错会变成 500） */
  private async assertRolesExist(roleIds?: number[]): Promise<void> {
    if (!roleIds?.length) return;
    const count = await this.prisma.role.count({ where: { id: { in: roleIds } } });
    if (count !== new Set(roleIds).size) throw new BadRequestException('部分角色不存在，请刷新后重试');
  }

  /**
   * 保护最后一个启用的超级管理员：不允许禁用/删除该账号，也不允许摘掉其超管角色。
   * 在事务内对超管角色的关联行加锁（FOR UPDATE），两个超管同时互相禁用时串行执行，后者会被拒绝。
   */
  private async assertNotLastSuperAdmin(
    tx: Prisma.TransactionClient,
    userId: number,
    change: { disable?: boolean; newRoleIds?: number[] },
  ): Promise<void> {
    const superRole = await tx.role.findUnique({ where: { code: SUPER_ROLE } });
    if (!superRole) return;
    // 锁住所有超管关联行：并发修改超管状态的事务在此排队（表名与 Prisma 模型同名，Linux 下大小写敏感）
    const supers = await tx.$queryRaw<{ userId: number }[]>`
      SELECT ur.userId FROM \`UserRole\` ur
      JOIN \`User\` u ON u.id = ur.userId
      WHERE ur.roleId = ${superRole.id} AND u.deletedAt IS NULL AND u.status = 'ENABLED'
      FOR UPDATE`;
    if (!supers.some((s) => Number(s.userId) === userId)) return; // 目标不是启用中的超管
    if (supers.length > 1) return; // 还有其他启用的超管，放行
    if (change.disable) throw new BadRequestException('不允许禁用/删除最后一个启用的超级管理员');
    if (change.newRoleIds && !change.newRoleIds.includes(superRole.id)) {
      throw new BadRequestException('不允许移除最后一个超级管理员的角色');
    }
  }
}

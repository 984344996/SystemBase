import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { paginate } from '../../core/pagination/paginate';
import { PermissionCacheService } from '../../core/security/permission-cache.service';
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
      select: USER_SELECT,
    });
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new BadRequestException(`用户名「${dto.username}」已存在`);
    const { roleIds, password, ...data } = dto;
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

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    const { roleIds, ...data } = dto;
    // 最后一个启用的超管不允许被禁用/摘除超管角色（防止系统失去管理员）
    if (data.status === 'DISABLED' || roleIds) {
      await this.assertNotLastSuperAdmin(id, { disable: data.status === 'DISABLED', newRoleIds: roleIds });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
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
  async remove(id: number) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    await this.assertNotLastSuperAdmin(id, { disable: true });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } }),
      this.revokeAllRefreshTokens(id),
    ]);
    this.permCache.invalidateUser(id); // 已删除用户的 accessToken 立即失效
    return { success: true };
  }

  async resetPassword(id: number, newPassword: string) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('用户不存在');
    assertPasswordUsable(newPassword, user.username, user.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id },
        data: {
          password: await bcrypt.hash(newPassword, 10),
          // 管理员重置的密码是临时密码，登录后强制改密
          mustChangePassword: true,
          pwdUpdatedAt: new Date(),
        },
      }),
      this.revokeAllRefreshTokens(id), // 重置密码后旧登录态全部失效
    ]);
    return { success: true };
  }

  // ---------- 内部 ----------

  /** 吊销该用户全部未作废的 refreshToken（全端下线） */
  private revokeAllRefreshTokens(userId: number) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * 保护最后一个启用的超级管理员：不允许禁用/删除该账号，也不允许摘掉其超管角色。
   * （不再用 id===1 硬编码——非 seed 初始化的库不一定成立，按角色动态判断）
   */
  private async assertNotLastSuperAdmin(
    userId: number,
    change: { disable?: boolean; newRoleIds?: number[] },
  ): Promise<void> {
    const superRole = await this.prisma.role.findUnique({ where: { code: 'SUPER_ADMIN' } });
    if (!superRole) return;
    const target = await this.prisma.userRole.findFirst({ where: { userId, roleId: superRole.id } });
    if (!target) return; // 目标不是超管，不涉及本保护
    const otherSupers = await this.prisma.userRole.count({
      where: {
        roleId: superRole.id,
        userId: { not: userId },
        user: { deletedAt: null, status: 'ENABLED' },
      },
    });
    if (otherSupers > 0) return; // 还有其他启用的超管，放行
    if (change.disable) throw new BadRequestException('不允许禁用/删除最后一个启用的超级管理员');
    if (change.newRoleIds && !change.newRoleIds.includes(superRole.id)) {
      throw new BadRequestException('不允许移除最后一个超级管理员的角色');
    }
  }
}

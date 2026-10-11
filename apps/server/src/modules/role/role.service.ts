import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { paginate } from '../../core/pagination/paginate';
import { PermissionCacheService } from '../../core/security/permission-cache.service';
import { CreateRoleDto, QueryRoleDto, UpdateRoleDto } from './role.dto';

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permCache: PermissionCacheService,
  ) {}

  async list(query: QueryRoleDto) {
    return paginate(this.prisma, this.prisma.role, {
      where: query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
        : {},
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      include: { _count: { select: { users: true, menus: true } } },
    });
  }

  /** 全量角色（下拉框用） */
  all() {
    return this.prisma.role.findMany({
      where: { status: 'ENABLED' },
      select: { id: true, code: true, name: true },
      orderBy: { id: 'asc' },
    });
  }

  async detail(id: number) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { menus: { select: { menuId: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    return { ...role, menuIds: role.menus.map((m) => m.menuId) };
  }

  async create(dto: CreateRoleDto) {
    const exists = await this.prisma.role.findUnique({ where: { code: dto.code } });
    if (exists) throw new BadRequestException(`角色编码「${dto.code}」已存在`);
    const { menuIds, ...data } = dto;
    // 并发竞态兜底：撞唯一约束(P2002)时转友好提示而非 500
    return withUniqueViolation(
      () =>
        this.prisma.role.create({
          data: { ...data, ...(menuIds?.length ? { menus: { create: menuIds.map((menuId) => ({ menuId })) } } : {}) },
        }),
      `角色编码「${dto.code}」已存在`,
    );
  }

  async update(id: number, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('角色不存在');
    if (role.code === 'SUPER_ADMIN' && dto.status === 'DISABLED') {
      throw new BadRequestException('内置超管角色不允许禁用');
    }
    const { menuIds, ...data } = dto;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (menuIds) {
        await tx.roleMenu.deleteMany({ where: { roleId: id } });
        if (menuIds.length) {
          await tx.roleMenu.createMany({ data: menuIds.map((menuId) => ({ roleId: id, menuId })) });
        }
      }
      return tx.role.update({ where: { id }, data });
    });
    this.permCache.invalidateAll(); // 角色状态/授权变更影响该角色下所有用户
    return updated;
  }

  async remove(id: number) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw new NotFoundException('角色不存在');
    if (role.code === 'SUPER_ADMIN') throw new BadRequestException('内置超管角色不允许删除');
    if (role._count.users > 0) throw new BadRequestException('该角色下仍有用户，无法删除');
    await this.prisma.role.delete({ where: { id } });
    this.permCache.invalidateAll();
    return { success: true };
  }
}

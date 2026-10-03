import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MenuDto } from './menu.dto';
import { PermissionCacheService } from '../../core/security/permission-cache.service';

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permCache: PermissionCacheService,
  ) {}

  /** 全量菜单树（菜单管理页数据源） */
  async tree() {
    const menus = await this.prisma.menu.findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
    const map = new Map<number, any>();
    menus.forEach((m) => map.set(m.id, { ...m, children: [] }));
    const roots: any[] = [];
    map.forEach((node) => {
      const parent = node.parentId ? map.get(node.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    });
    return roots;
  }

  async create(dto: MenuDto) {
    this.assertMenuShape(dto);
    if (dto.parentId) {
      const parent = await this.prisma.menu.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new BadRequestException('父级菜单不存在');
      if (parent.type === 'MENU' || parent.type === 'BUTTON') {
        throw new BadRequestException('父级必须是目录类型');
      }
    }
    return this.prisma.menu.create({ data: { ...dto } });
  }

  async update(id: number, dto: MenuDto) {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException('菜单不存在');
    if (dto.parentId === id) throw new BadRequestException('父级不能是自己');
    if (dto.parentId) await this.assertNoCycle(id, dto.parentId);
    this.assertMenuShape(dto);
    const updated = await this.prisma.menu.update({ where: { id }, data: { ...dto } });
    this.permCache.invalidateAll(); // 权限码/状态变更影响所有被授权该菜单的用户
    return updated;
  }

  async remove(id: number) {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException('菜单不存在');
    const count = await this.prisma.menu.count({ where: { parentId: id } });
    if (count > 0) throw new BadRequestException('存在子菜单，请先删除子菜单');
    // 角色-菜单关联一并清理，事务保证一致
    await this.prisma.$transaction([
      this.prisma.roleMenu.deleteMany({ where: { menuId: id } }),
      this.prisma.menu.delete({ where: { id } }),
    ]);
    this.permCache.invalidateAll();
    return { success: true };
  }

  /** 沿父链上溯，防止 A→B→A 之类的循环引用导致节点从菜单树上消失 */
  private async assertNoCycle(id: number, parentId: number): Promise<void> {
    let cursor: number = parentId;
    const seen = new Set<number>();
    while (cursor > 0) {
      if (cursor === id) throw new BadRequestException('父级设置形成循环引用');
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent = await this.prisma.menu.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = parent?.parentId ?? 0;
    }
  }

  /** 类型与字段匹配校验：MENU 必须有 path/component；BUTTON 必须有 permission */
  private assertMenuShape(dto: MenuDto) {
    if (dto.type === 'MENU' && (!dto.path || !dto.component)) {
      throw new BadRequestException('页面菜单必须填写路由路径与前端组件路径');
    }
    if (dto.type === 'BUTTON' && !dto.permission) {
      throw new BadRequestException('按钮必须填写权限码');
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { buildTree } from '@sb/shared';
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
    return buildTree(menus);
  }

  async create(dto: MenuDto) {
    this.assertMenuShape(dto);
    await this.assertParent(dto.type, dto.parentId);
    return this.prisma.menu.create({ data: this.normalize(dto) });
  }

  async update(id: number, dto: MenuDto) {
    const menu = await this.prisma.menu.findUnique({ where: { id } });
    if (!menu) throw new NotFoundException('菜单不存在');
    if (dto.parentId === id) throw new BadRequestException('父级不能是自己');
    this.assertMenuShape(dto);
    // 有子节点时不允许改类型：否则子节点会挂在不合法的父级下（如按钮下挂页面）
    if (dto.type !== menu.type && (await this.prisma.menu.count({ where: { parentId: id } })) > 0) {
      throw new BadRequestException('存在子节点时不能修改类型，请先移走或删除子节点');
    }
    // 与新增走同一套父级校验（原来只防循环，可把菜单挂到按钮或已删除的节点下，菜单会从树和路由里消失）
    await this.assertParent(dto.type, dto.parentId);
    if (dto.parentId) await this.assertNoCycle(id, dto.parentId);
    const updated = await this.prisma.menu.update({ where: { id }, data: this.normalize(dto) });
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

  /**
   * 层级规则（与 seed 及前端菜单页一致）：
   *   目录 DIRECTORY → 顶级或目录下；页面 MENU → 顶级或目录下；按钮 BUTTON → 只能在页面下
   *   parentId = 0 表示顶级（按钮不能放顶级）
   */
  private async assertParent(type: string, parentId: number) {
    if (!parentId) {
      if (type === 'BUTTON') throw new BadRequestException('按钮必须挂在页面菜单下');
      return;
    }
    const parent = await this.prisma.menu.findUnique({ where: { id: parentId }, select: { type: true } });
    if (!parent) throw new BadRequestException('父级菜单不存在');
    if (type === 'BUTTON' && parent.type !== 'MENU') throw new BadRequestException('按钮必须挂在页面菜单下');
    if (type !== 'BUTTON' && parent.type !== 'DIRECTORY') throw new BadRequestException('目录和页面只能挂在目录下');
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

  /**
   * 按类型清掉不适用的字段（前端切换类型后，被隐藏的输入框里的旧值仍会提交上来）：
   *   目录：无组件、无权限码；按钮：无路由、组件、图标，且不出现在侧栏
   */
  private normalize(dto: MenuDto) {
    const data = { ...dto };
    if (dto.type === 'DIRECTORY') Object.assign(data, { component: null, permission: null });
    if (dto.type === 'BUTTON') Object.assign(data, { path: null, component: null, icon: null });
    return data;
  }
}

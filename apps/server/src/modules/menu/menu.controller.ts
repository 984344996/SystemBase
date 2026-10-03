import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { MenuService } from './menu.service';
import { MenuDto } from './menu.dto';

@Controller('menus')
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  @Get()
  @RequirePermissions('system:menu:list')
  tree() {
    return this.menus.tree();
  }

  @Post()
  @RequirePermissions('system:menu:create')
  @OperateLog({ module: '菜单管理', action: '创建菜单' })
  create(@Body() dto: MenuDto) {
    return this.menus.create(dto);
  }

  @Put(':id')
  @RequirePermissions('system:menu:update')
  @OperateLog({ module: '菜单管理', action: '更新菜单' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: MenuDto) {
    return this.menus.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('system:menu:delete')
  @OperateLog({ module: '菜单管理', action: '删除菜单' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.menus.remove(id);
  }
}

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { MenuService } from './menu.service';
import { MenuDto } from './menu.dto';

@Controller('menus')@ApiTags('菜单管理')
@ApiBearerAuth('accessToken')
export class MenuController {
  constructor(private readonly menus: MenuService) {}

  @Get()
  @ApiOperation({ summary: '菜单树（全量，管理页数据源）' })
  @RequirePermissions('system:menu:list')
  tree() {
    return this.menus.tree();
  }

  @Post()
  @ApiOperation({ summary: '创建菜单' })
  @RequirePermissions('system:menu:create')
  @OperateLog({ module: '菜单管理', action: '创建菜单' })
  create(@Body() dto: MenuDto) {
    return this.menus.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新菜单' })
  @RequirePermissions('system:menu:update')
  @OperateLog({ module: '菜单管理', action: '更新菜单' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: MenuDto) {
    return this.menus.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除菜单（连带清理角色关联）' })
  @RequirePermissions('system:menu:delete')
  @OperateLog({ module: '菜单管理', action: '删除菜单' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.menus.remove(id);
  }
}

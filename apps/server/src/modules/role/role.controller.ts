import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { RoleService } from './role.service';
import { MenuService } from '../menu/menu.service';
import { CreateRoleDto, QueryRoleDto, UpdateRoleDto } from './role.dto';

@Controller('roles')
export class RoleController {
  constructor(
    private readonly service: RoleService,
    private readonly menuService: MenuService,
  ) {}

  @Get()
  @RequirePermissions('system:role:list')
  list(@Query() query: QueryRoleDto) {
    return this.service.list(query);
  }

  /** 全量角色(公开给登录用户，建用户时下拉选择) */
  @Get('all')
  all() {
    return this.service.all();
  }

  /** 全量菜单树(分配角色菜单用，拥有角色查看权限即可访问) */
  @Get('menu-tree')
  @RequirePermissions('system:role:list')
  menuTree() {
    return this.menuService.tree();
  }

  @Get(':id')
  @RequirePermissions('system:role:list')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions('system:role:create')
  @OperateLog({ module: '角色管理', action: '创建角色' })
  create(@Body() dto: CreateRoleDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('system:role:update')
  @OperateLog({ module: '角色管理', action: '更新角色' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('system:role:delete')
  @OperateLog({ module: '角色管理', action: '删除角色' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

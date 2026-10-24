import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CurrentUser } from '../../core/security/current-user.decorator';
import { AuthUser } from '../../core/security/jwt.strategy';
import { RoleService } from './role.service';
import { MenuService } from '../menu/menu.service';
import { CreateRoleDto, QueryRoleDto, UpdateRoleDto } from './role.dto';

@Controller('roles')@ApiTags('角色管理')
@ApiBearerAuth('accessToken')
export class RoleController {
  constructor(
    private readonly service: RoleService,
    private readonly menuService: MenuService,
  ) {}

  @Get()
  @ApiOperation({ summary: '角色列表（分页）' })
  @RequirePermissions('system:role:list')
  list(@Query() query: QueryRoleDto) {
    return this.service.list(query);
  }

  /** 全量启用角色（建/编辑用户时下拉选择）：只对有用户管理权限的人开放 */
  @Get('all')
  @RequirePermissions('system:user:create', 'system:user:update', 'system:role:list')
  @ApiOperation({ summary: '全量角色（下拉选择用）' })
  all() {
    return this.service.all();
  }

  /** 全量菜单树(分配角色菜单用，拥有角色查看权限即可访问) */
  @Get('menu-tree')
  @ApiOperation({ summary: '全量菜单树（分配角色菜单用）' })
  @RequirePermissions('system:role:list')
  menuTree() {
    return this.menuService.tree();
  }

  @Get(':id')
  @ApiOperation({ summary: '角色详情（含已授权菜单）' })
  @RequirePermissions('system:role:list')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.service.detail(id);
  }

  @Post()
  @ApiOperation({ summary: '创建角色' })
  @RequirePermissions('system:role:create')
  @OperateLog({ module: '角色管理', action: '创建角色' })
  create(@Body() dto: CreateRoleDto, @CurrentUser() operator: AuthUser) {
    return this.service.create(dto, operator);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新角色（含菜单授权）' })
  @RequirePermissions('system:role:update')
  @OperateLog({ module: '角色管理', action: '更新角色' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto, @CurrentUser() operator: AuthUser) {
    return this.service.update(id, dto, operator);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  @RequirePermissions('system:role:delete')
  @OperateLog({ module: '角色管理', action: '删除角色' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

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
import { UserService } from './user.service';
import { CreateUserDto, QueryUserDto, ResetPasswordDto, UpdateUserDto } from './user.dto';

@ApiTags('用户管理')
@ApiBearerAuth('accessToken')
@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get()
  @ApiOperation({ summary: '用户列表（分页）' })
  @RequirePermissions('system:user:list')
  list(@Query() query: QueryUserDto) {
    return this.service.list(query);
  }

  @Post()
  @ApiOperation({ summary: '创建用户' })
  @RequirePermissions('system:user:create')
  @OperateLog({ module: '用户管理', action: '创建用户' })
  create(@Body() dto: CreateUserDto, @CurrentUser() operator: AuthUser) {
    return this.service.create(dto, operator);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新用户' })
  @RequirePermissions('system:user:update')
  @OperateLog({ module: '用户管理', action: '更新用户' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() operator: AuthUser) {
    return this.service.update(id, dto, operator);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除用户（软删除，吊销登录态）' })
  @RequirePermissions('system:user:delete')
  @OperateLog({ module: '用户管理', action: '删除用户' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() operator: AuthUser) {
    return this.service.remove(id, operator);
  }

  @Put(':id/password')
  @ApiOperation({ summary: '重置密码（登录后强制改密）' })
  @RequirePermissions('system:user:resetPwd')
  @OperateLog({ module: '用户管理', action: '重置密码' })
  resetPassword(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto, @CurrentUser() operator: AuthUser) {
    return this.service.resetPassword(id, dto.newPassword, operator);
  }
}

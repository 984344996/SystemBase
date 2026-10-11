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
import { UserService } from './user.service';
import { CreateUserDto, QueryUserDto, ResetPasswordDto, UpdateUserDto } from './user.dto';

@Controller('users')
export class UserController {
  constructor(private readonly service: UserService) {}

  @Get()
  @RequirePermissions('system:user:list')
  list(@Query() query: QueryUserDto) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions('system:user:create')
  @OperateLog({ module: '用户管理', action: '创建用户' })
  create(@Body() dto: CreateUserDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('system:user:update')
  @OperateLog({ module: '用户管理', action: '更新用户' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('system:user:delete')
  @OperateLog({ module: '用户管理', action: '删除用户' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Put(':id/password')
  @RequirePermissions('system:user:resetPwd')
  @OperateLog({ module: '用户管理', action: '重置密码' })
  resetPassword(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto) {
    return this.service.resetPassword(id, dto.newPassword);
  }
}

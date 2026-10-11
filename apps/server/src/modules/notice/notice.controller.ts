import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { CurrentUser } from '../../core/security/current-user.decorator';
import { AuthUser } from '../../core/security/jwt.strategy';
import { NoticeService } from './notice.service';
import { CreateNoticeDto, QueryNoticeDto, UpdateNoticeDto } from './notice.dto';

@ApiTags('通知公告')
@ApiBearerAuth('accessToken')
@Controller('notices')
export class NoticeController {
  constructor(private readonly service: NoticeService) {}

  // ---------- 用户侧（登录即可访问） ----------
  @Get('mine')
  @ApiOperation({ summary: '我可见的公告/消息（含已读标记，置顶优先）' })
  mine(@CurrentUser() user: AuthUser) {
    return this.service.mine(user.id);
  }

  @Get('unread-count')
  @ApiOperation({ summary: '未读数量（顶栏红点）' })
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  @Post(':id/read')
  @ApiOperation({ summary: '标记已读（幂等）' })
  read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.read(id, user.id);
  }

  // ---------- 管理端 ----------
  @Get()
  @RequirePermissions('system:notice:list')
  @ApiOperation({ summary: '公告管理列表（分页）' })
  list(@Query() query: QueryNoticeDto) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions('system:notice:create')
  @OperateLog({ module: '通知公告', action: '新增公告' })
  create(@Body() dto: CreateNoticeDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Put(':id')
  @RequirePermissions('system:notice:update')
  @OperateLog({ module: '通知公告', action: '编辑公告' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateNoticeDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions('system:notice:publish')
  @OperateLog({ module: '通知公告', action: '发布公告' })
  @ApiOperation({ summary: '发布（草稿 → 已发布）' })
  publish(@Param('id', ParseIntPipe) id: number) {
    return this.service.publish(id);
  }

  @Delete(':id')
  @RequirePermissions('system:notice:delete')
  @OperateLog({ module: '通知公告', action: '删除公告' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}

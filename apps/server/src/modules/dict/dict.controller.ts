import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { DictService } from './dict.service';
import { CreateDictDto, CreateDictItemDto, QueryDictDto, UpdateDictDto, UpdateDictItemDto } from './dict.dto';

@ApiTags('数据字典')
@ApiBearerAuth('accessToken')
@Controller('dicts')
export class DictController {
  constructor(private readonly service: DictService) {}

  // ---------- 字典类型 ----------
  @Get()
  @RequirePermissions('system:dict:list')
  @ApiOperation({ summary: '字典类型列表' })
  list(@Query() query: QueryDictDto) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions('system:dict:create')
  @OperateLog({ module: '数据字典', action: '新增字典' })
  @ApiOperation({ summary: '新增字典类型' })
  create(@Body() dto: CreateDictDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('system:dict:update')
  @OperateLog({ module: '数据字典', action: '修改字典' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDictDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('system:dict:delete')
  @OperateLog({ module: '数据字典', action: '删除字典' })
  @ApiOperation({ summary: '删除字典（字典项级联删除）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  // ---------- 字典项 ----------
  @Get(':id/items')
  @RequirePermissions('system:dict:list')
  @ApiOperation({ summary: '某字典下的全部选项' })
  items(@Param('id', ParseIntPipe) id: number) {
    return this.service.items(id);
  }

  @Post(':id/items')
  @RequirePermissions('system:dict:update')
  @OperateLog({ module: '数据字典', action: '新增选项' })
  addItem(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateDictItemDto) {
    return this.service.addItem(id, dto);
  }

  @Put('items/:itemId')
  @RequirePermissions('system:dict:update')
  @OperateLog({ module: '数据字典', action: '修改选项' })
  updateItem(@Param('itemId', ParseIntPipe) itemId: number, @Body() dto: UpdateDictItemDto) {
    return this.service.updateItem(itemId, dto);
  }

  @Delete('items/:itemId')
  @RequirePermissions('system:dict:delete')
  @OperateLog({ module: '数据字典', action: '删除选项' })
  removeItem(@Param('itemId', ParseIntPipe) itemId: number) {
    return this.service.removeItem(itemId);
  }

  // ---------- 业务读取（下拉用，登录即可访问） ----------
  @Get('options/:code')
  @ApiOperation({ summary: '按字典编码取启用中的选项（前端下拉用）' })
  options(@Param('code') code: string) {
    return this.service.options(code);
  }
}

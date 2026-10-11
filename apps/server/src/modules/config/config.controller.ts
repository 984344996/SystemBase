import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { ConfigService } from './config.service';
import { CreateConfigDto, QueryConfigDto, UpdateConfigDto } from './config.dto';

@ApiTags('系统参数')
@ApiBearerAuth('accessToken')
@Controller('configs')
export class ConfigController {
  constructor(private readonly service: ConfigService) {}

  @Get()
  @RequirePermissions('system:config:list')
  @ApiOperation({ summary: '系统参数列表（可按分组/关键字过滤）' })
  list(@Query() query: QueryConfigDto) {
    return this.service.list(query);
  }

  /** 全部参数：前端一次性拉取缓存（下拉/开关渲染用） */
  @Get('all')
  @RequirePermissions('system:config:list')
  @ApiOperation({ summary: '全部系统参数' })
  all() {
    return this.service.all();
  }

  @Post()
  @RequirePermissions('system:config:create')
  @OperateLog({ module: '系统参数', action: '新增参数' })
  @ApiOperation({ summary: '新增系统参数' })
  create(@Body() dto: CreateConfigDto) {
    return this.service.create(dto);
  }

  @Put(':key')
  @RequirePermissions('system:config:update')
  @OperateLog({ module: '系统参数', action: '修改参数' })
  @ApiOperation({ summary: '修改系统参数（即时生效，无需重启）' })
  update(@Param('key') key: string, @Body() dto: UpdateConfigDto) {
    return this.service.update(key, dto);
  }

  @Delete(':key')
  @RequirePermissions('system:config:delete')
  @OperateLog({ module: '系统参数', action: '删除参数' })
  @ApiOperation({ summary: '删除系统参数（内置项不允许删除）' })
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}

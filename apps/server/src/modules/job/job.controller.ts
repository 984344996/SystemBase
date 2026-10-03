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
import { JobService } from './job.service';
import { listHandlerKeys } from './job-registry';
import { CreateJobDto, QueryJobLogDto, UpdateJobDto } from './job.dto';

@Controller('jobs')
export class JobController {
  constructor(private readonly jobs: JobService) {}

  @Get()
  @RequirePermissions('system:job:list')
  list() {
    return this.jobs.list();
  }

  /** 可用处理器下拉(创建任务时选择) */
  @Get('handlers')
  @RequirePermissions('system:job:list')
  handlers() {
    return listHandlerKeys();
  }

  @Get('logs')
  @RequirePermissions('system:job:list')
  logs(@Query() query: QueryJobLogDto) {
    return this.jobs.logs(query);
  }

  @Post()
  @RequirePermissions('system:job:create')
  @OperateLog({ module: '定时任务', action: '创建任务' })
  create(@Body() dto: CreateJobDto) {
    return this.jobs.create(dto);
  }

  @Put(':id')
  @RequirePermissions('system:job:update')
  @OperateLog({ module: '定时任务', action: '更新任务' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJobDto) {
    return this.jobs.update(id, dto);
  }

  /** 启用/暂停切换 */
  @Put(':id/toggle')
  @RequirePermissions('system:job:update')
  @OperateLog({ module: '定时任务', action: '启停任务' })
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.toggle(id);
  }

  @Delete(':id')
  @RequirePermissions('system:job:delete')
  @OperateLog({ module: '定时任务', action: '删除任务' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.remove(id);
  }

  /** 立即执行一次 */
  @Post(':id/run')
  @RequirePermissions('system:job:run')
  @OperateLog({ module: '定时任务', action: '手动执行' })
  runOnce(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.runOnce(id);
  }
}

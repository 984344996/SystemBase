import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { SystemCleanupJob } from './system-cleanup.job';

@Module({
  imports: [FileModule], // 内置 system.cleanup 任务需要 FileService.purge 回收软删文件
  controllers: [JobController],
  providers: [JobService, SystemCleanupJob],
  exports: [JobService],
})
export class JobModule {}

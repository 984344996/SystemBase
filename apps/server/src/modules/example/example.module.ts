import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { ExampleController } from './example.controller';
import { HelloJob, SystemCleanupJob } from './example.jobs';

@Module({
  imports: [FileModule], // system.cleanup 需要 FileService.purge 回收软删文件
  controllers: [ExampleController],
  providers: [HelloJob, SystemCleanupJob],
})
export class ExampleModule {}

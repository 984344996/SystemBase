import { Module } from '@nestjs/common';
import { ExampleController } from './example.controller';
import { HelloJob } from './example.jobs';

/**
 * 示例模块：演示业务模块的标准结构（控制器 + 定时任务）。
 * 开新项目时可整体删除：删掉本目录 + app.module.ts 中的 ExampleModule + seed.ts 的「示例数据」区块。
 */
@Module({
  controllers: [ExampleController],
  providers: [HelloJob],
})
export class ExampleModule {}

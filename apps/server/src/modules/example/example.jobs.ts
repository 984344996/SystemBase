import { Injectable } from '@nestjs/common';
import { JobContext, JobHandler } from '../job/job-registry';

/**
 * 示例任务：打印问候。演示 @JobHandler 的最小写法。
 * 业务上无副作用，可随 example 模块整体删除（同时删除 seed.ts 里「示例数据」区块的「示例-每日问候」任务；
 * 不删也没关系：找不到处理器的任务会被自动暂停）。
 * 框架内置的「系统数据清理」任务在 modules/job/system-cleanup.job.ts，不在这里。
 */
@JobHandler('example.hello')
@Injectable()
export class HelloJob implements JobHandler {
  async run(ctx: JobContext): Promise<string> {
    const greeting = `Hello SystemBase！任务「${ctx.jobName}」执行于 ${new Date().toISOString()}，参数: ${JSON.stringify(ctx.params ?? null)}`;
    ctx.logger.job({ jobId: ctx.jobId, jobName: ctx.jobName }, greeting);
    return greeting;
  }
}

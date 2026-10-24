import { Injectable } from '@nestjs/common';
import { JobContext, JobHandler } from '../job/job-registry';
import { LockService } from '../../core/lock/lock.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FileService } from '../file/file.service';

/**
 * 示例任务：打印问候。演示 @JobHandler 的最小写法。
 * 业务上无副作用，可随时删除整个 example 模块。
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

/**
 * 内置任务：清理过期的数据库锁记录 + 已过期/已吊销 7 天的刷新令牌 + 软删超过 7 天的上传文件实体。
 * （日志文件由日志模块按 LOG_KEEP_DAYS 自动清理，无需在此处理）
 * 建议保持启用（每小时一次）。
 */
@JobHandler('system.cleanup')
@Injectable()
export class SystemCleanupJob implements JobHandler {
  constructor(
    private readonly lock: LockService,
    private readonly prisma: PrismaService,
    private readonly files: FileService,
  ) {}

  /** 返回的摘要会作为 result 写入本次执行记录（event=run），无需另外打日志 */
  async run(): Promise<string> {
    const locks = await this.lock.cleanupExpired();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
    const tokens = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: sevenDaysAgo } }] },
    });
    const files = await this.files.purge(7);
    return `清理完成：过期锁 ${locks} 条、过期/已吊销 refreshToken ${tokens.count} 条、已删除文件 ${files} 个`;
  }
}

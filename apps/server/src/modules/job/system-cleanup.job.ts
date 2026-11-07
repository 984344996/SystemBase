import { Injectable } from '@nestjs/common';
import { JobHandler } from './job-registry';
import { LockService } from '../../core/lock/lock.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { LoginGuardService } from '../../core/security/login-guard.service';
import { FileService } from '../file/file.service';

/**
 * 框架内置任务（属于框架，不随 example 模块删除）：
 *   - 过期的数据库锁记录
 *   - 已过期 / 已吊销超过 7 天的刷新令牌
 *   - 软删除超过 7 天的上传文件实体
 *   - 过期的登录验证码与失败计数（LoginGuardService 自身每分钟也会清理一次，这里兜底）
 * 日志文件由日志模块按 LOG_KEEP_DAYS 自动清理，无需在此处理。
 * seed 默认创建「系统数据清理」任务每小时执行一次，建议保持启用。
 */
@JobHandler('system.cleanup')
@Injectable()
export class SystemCleanupJob implements JobHandler {
  constructor(
    private readonly lock: LockService,
    private readonly prisma: PrismaService,
    private readonly files: FileService,
    private readonly loginGuard: LoginGuardService,
  ) {}

  /** 返回的摘要会作为 result 写入本次执行记录（event=run），无需另外打日志 */
  async run(): Promise<string> {
    const locks = await this.lock.cleanupExpired();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
    const tokens = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: sevenDaysAgo } }] },
    });
    const files = await this.files.purge(7);
    const guards = this.loginGuard.cleanup();
    return `清理完成：过期锁 ${locks} 条、过期/已吊销 refreshToken ${tokens.count} 条、已删除文件 ${files} 个、过期验证码/失败计数 ${guards} 条`;
  }
}

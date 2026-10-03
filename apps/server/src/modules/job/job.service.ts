import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as cronParser from 'cron-parser';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AppLogger } from '../../core/logger/logger.service';
import { LogReaderService } from '../../core/logger/log-reader.service';
import { formatLocalTime } from '../../core/logger/log-streams';
import { runWithTraceId } from '../../core/logger/trace.context';
import { LockService } from '../../core/lock/lock.service';
import { JOB_HANDLERS, JobHandler, JobContext } from './job-registry';
import { CreateJobDto, QueryJobLogDto, UpdateJobDto } from './job.dto';

@Injectable()
export class JobService implements OnModuleInit {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLogger: AppLogger,
    private readonly lock: LockService,
    private readonly moduleRef: ModuleRef,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
    private readonly logReader: LogReaderService,
  ) {}

  // ---------- 启动时重建全部调度 ----------
  async onModuleInit() {
    const jobs = await this.prisma.job.findMany();
    for (const job of jobs) {
      if (!JOB_HANDLERS.has(job.handlerKey)) {
        this.logger.warn(`任务「${job.name}」的 handler ${job.handlerKey} 未注册(代码缺失)，已标记失效`);
        if (job.status === 'ENABLED') {
          await this.prisma.job.update({ where: { id: job.id }, data: { status: 'PAUSED', remark: 'handler 未注册，自动暂停' } });
        }
        continue;
      }
      if (job.status === 'ENABLED') {
        await this.schedule(job.id, job.cronExpr);
        await this.handleMisfire(job);
      }
    }
    this.logger.log(`定时任务调度就绪：${JOB_HANDLERS.size} 个 handler，${jobs.filter((j) => j.status === 'ENABLED').length} 个启用任务`);
  }

  // ---------- 查询 ----------
  async list() {
    const jobs = await this.prisma.job.findMany({ orderBy: { id: 'asc' } });
    return jobs.map((j) => ({ ...j, handlerExists: JOB_HANDLERS.has(j.handlerKey) }));
  }

  /** 执行记录：从日志文件读取（category=job, event=run），按天查询 */
  async logs(query: QueryJobLogDto) {
    return this.logReader.query({
      date: query.date,
      category: 'job',
      keyword: '"event":"run"',
      match: (e) =>
        (!query.jobId || e.jobId === query.jobId) && (!query.status || e.status === query.status),
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  // ---------- CRUD（变更即时生效） ----------
  async create(dto: CreateJobDto) {
    if (!JOB_HANDLERS.has(dto.handlerKey)) {
      throw new BadRequestException(`处理器 ${dto.handlerKey} 未注册，可选：${[...JOB_HANDLERS.keys()].join('、')}`);
    }
    this.assertCron(dto.cronExpr);
    const exists = await this.prisma.job.findUnique({ where: { name: dto.name } });
    if (exists) throw new BadRequestException(`任务名「${dto.name}」已存在`);

    const job = await this.prisma.job.create({
      data: {
        name: dto.name,
        handlerKey: dto.handlerKey,
        cronExpr: dto.cronExpr,
        params: dto.params ? JSON.parse(dto.params) : undefined,
        misfirePolicy: dto.misfirePolicy || 'SKIP',
        timeoutSec: dto.timeoutSec ?? 300,
        remark: dto.remark,
        status: 'ENABLED',
      },
    });
    await this.schedule(job.id, job.cronExpr);
    return job;
  }

  async update(id: number, dto: UpdateJobDto) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('任务不存在');
    this.assertCron(dto.cronExpr);
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        name: dto.name,
        cronExpr: dto.cronExpr,
        params: dto.params ? JSON.parse(dto.params) : undefined,
        misfirePolicy: dto.misfirePolicy,
        timeoutSec: dto.timeoutSec,
        remark: dto.remark,
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
    await this.reschedule(updated);
    return updated;
  }

  async toggle(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('任务不存在');
    if (!JOB_HANDLERS.has(job.handlerKey)) {
      throw new BadRequestException(`处理器 ${job.handlerKey} 未注册，无法启用`);
    }
    const status = job.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    const updated = await this.prisma.job.update({ where: { id }, data: { status } });
    await this.reschedule(updated);
    return updated;
  }

  async remove(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('任务不存在');
    this.deschedule(id);
    await this.prisma.job.delete({ where: { id } });
    return { success: true };
  }

  /** 手动立即执行一次（不等 cron） */
  async runOnce(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('任务不存在');
    if (!JOB_HANDLERS.has(job.handlerKey)) {
      throw new BadRequestException(`处理器 ${job.handlerKey} 未注册`);
    }
    const result = await this.run(id, 'manual');
    return result;
  }

  // ---------- 调度核心 ----------
  private cronJobName(id: number) {
    return `job-${id}`;
  }

  private async schedule(id: number, cronExpr: string) {
    this.deschedule(id);
    // 注意：@nestjs/schedule v4 的 addCronJob(name, job) 只收 2 个参数，
    // 回调必须通过 CronJob 实例传入（直接传第三参会被告警忽略，任务不会执行）
    const job = new CronJob(cronExpr, () => {
      runWithTraceId(this.appLogger.newTraceId(), () => {
        this.run(id, 'cron').catch((e) => this.logger.error(`任务 #${id} 调度执行异常: ${e.message}`));
      });
    });
    this.scheduler.addCronJob(this.cronJobName(id), job);
    job.start();
    await this.prisma.job.update({ where: { id }, data: { nextRunAt: this.nextRunAt(cronExpr) } });
  }

  private deschedule(id: number) {
    const name = this.cronJobName(id);
    if (this.scheduler.doesExist('cron', name)) {
      this.scheduler.deleteCronJob(name);
    }
  }

  /** 状态/cron 变更后重建调度 */
  private async reschedule(job: { id: number; status: string; cronExpr: string }) {
    if (job.status === 'ENABLED') {
      await this.schedule(job.id, job.cronExpr);
    } else {
      this.deschedule(job.id);
    }
  }

  /**
   * 执行一次任务（cron 触发与手动触发共用）：
   * 分布式锁防多实例并发 → 超时控制 → 执行记录写日志文件（event=run）。
   */
  async run(jobId: number, trigger: 'cron' | 'manual') {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return { skipped: true, reason: '任务不存在' };

    const base = { event: 'run', jobId, jobName: job.name, handlerKey: job.handlerKey, trigger, params: job.params };
    const release = await this.lock.acquire(`job:run:${jobId}`, (job.timeoutSec + 60) * 1000);
    if (!release) {
      this.appLogger.jobWarn({ ...base, status: 'SKIPPED_LOCK', costMs: 0 }, `任务跳过(锁被占用): ${job.name}`);
      return { skipped: true, status: 'SKIPPED_LOCK', reason: '其他实例正在执行' };
    }

    const startedAt = new Date();
    const startMs = Date.now();
    let status = 'SUCCESS';
    let result: string | null = null;
    let error: string | null = null;
    let timedOut = false;

    try {
      const handler = this.resolveHandler(job.handlerKey);
      const ctx: JobContext = {
        jobId: job.id,
        jobName: job.name,
        logger: this.appLogger,
        params: job.params,
      };
      const timeoutMs = (job.timeoutSec ?? 300) * 1000;
      /**
       * 超时控制：Promise.race 只能"放弃等待"，无法真正终止仍在后台执行的 handler。
       * 因此超时后【不释放分布式锁】——锁持有到 TTL 自然过期，
       * 防止 handler 尚未结束时其他实例抢到锁并发重入同一任务。
       */
      let timer: NodeJS.Timeout | undefined;
      try {
        const ret = await Promise.race([
          handler.run(ctx),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new Error(`执行超过 ${job.timeoutSec ?? 300}s，已放弃等待`));
            }, timeoutMs);
          }),
        ]);
        result = ret ? String(ret).slice(0, 2000) : null;
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      status = timedOut ? 'TIMEOUT' : 'FAILED';
      error = String(e?.stack || e?.message || e).slice(0, 5000);
    } finally {
      if (!timedOut) await release();
    }

    const costMs = Date.now() - startMs;
    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        prevRunAt: startedAt,
        ...(job.status === 'ENABLED' ? { nextRunAt: this.nextRunAt(job.cronExpr) } : {}),
      },
    });

    const fields = { ...base, status, startedAt: formatLocalTime(startedAt), costMs, result, error };
    if (status === 'SUCCESS') this.appLogger.job(fields, `任务执行成功: ${job.name}`);
    else this.appLogger.jobError(fields, `任务执行${status === 'TIMEOUT' ? '超时' : '失败'}: ${job.name}`);
    return { skipped: false, status, result, error, costMs };
  }

  // ---------- 辅助 ----------
  private resolveHandler(key: string): JobHandler {
    const ctor = JOB_HANDLERS.get(key);
    if (!ctor) throw new Error(`处理器 ${key} 未注册`);
    const instance = this.moduleRef.get(ctor as any, { strict: false });
    if (!instance) throw new Error(`处理器 ${key} 未被 Nest 容器管理，请确认所在 Module 已导入`);
    return instance as JobHandler;
  }

  private nextRunAt(cronExpr: string): Date {
    return cronParser.parseExpression(cronExpr).next().toDate();
  }

  /** 启动时错过触发窗口的处理 */
  private async handleMisfire(job: { id: number; name: string; cronExpr: string; misfirePolicy: string; nextRunAt: Date | null }) {
    if (!job.nextRunAt) return;
    const now = new Date();
    if (job.nextRunAt >= now) return;
    if (job.misfirePolicy === 'RUN_ONCE') {
      this.logger.log(`任务「${job.name}」错过触发窗口，按 RUN_ONCE 策略补跑一次`);
      await this.run(job.id, 'cron');
    } else {
      await this.prisma.job.update({ where: { id: job.id }, data: { nextRunAt: this.nextRunAt(job.cronExpr) } });
    }
  }

  private assertCron(expr: string) {
    try {
      cronParser.parseExpression(expr, { currentDate: new Date() });
    } catch {
      throw new BadRequestException(`cron 表达式不合法: ${expr}（标准 5 段：分 时 日 月 周）`);
    }
  }
}

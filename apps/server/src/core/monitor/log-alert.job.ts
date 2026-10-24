import { Injectable } from '@nestjs/common';
import { JobContext, JobHandler } from '../../modules/job/job-registry';
import { LogReaderService } from '../logger/log-reader.service';

/**
 * 内置任务：日志告警（system.logAlert）
 *
 * 扫描当日日志文件，ERROR 条数超过阈值时写一条 WARN 级告警（可被日志检索/下载看到），
 * 并可选推送到 webhook（企业微信/钉钉/自建钩子）。
 *
 * 参数（任务页配置）: { "threshold": 20 }
 * 环境变量: LOG_ALERT_THRESHOLD（默认 50）、LOG_ALERT_WEBHOOK（留空则不推送）
 *
 * 说明：需要启用时在「定时任务」页新增任务选择处理器 system.logAlert（默认不自动创建，避免噪音）。
 */
@JobHandler('system.logAlert')
@Injectable()
export class LogAlertJob implements JobHandler {
  constructor(private readonly reader: LogReaderService) {}

  async run(ctx: JobContext): Promise<string> {
    const threshold = Number((ctx.params as { threshold?: number } | undefined)?.threshold ?? process.env.LOG_ALERT_THRESHOLD ?? 50);
    const page = await this.reader.query({ level: 'ERROR', page: 1, pageSize: 1 } as never);
    const count = page.total ?? 0;

    if (count <= threshold) {
      return `今日 ERROR ${count} 条，未超阈值 ${threshold}`;
    }

    const msg = `今日 ERROR 日志 ${count} 条，已超过阈值 ${threshold}，请及时排查（管理端「系统日志」按级别 ERROR 检索）`;
    ctx.logger.warnFields({ event: 'log_alert', jobId: ctx.jobId, jobName: ctx.jobName, errors: count, threshold }, msg);

    const webhook = process.env.LOG_ALERT_WEBHOOK || '';
    if (webhook) {
      try {
        const res = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `[SystemBase 告警] ${msg}`, level: 'warn', count, threshold }),
        });
        if (!res.ok) ctx.logger.warnFields({ event: 'log_alert_webhook', status: res.status }, `告警推送失败: HTTP ${res.status}`);
      } catch (e) {
        ctx.logger.warnFields({ event: 'log_alert_webhook' }, `告警推送失败: ${(e as Error).message}`);
      }
    }

    return `告警：${msg}`;
  }
}

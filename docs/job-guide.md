# 动态定时任务指南

## 设计一句话

**cron 存数据库、代码只注册处理器**：修改执行时间/参数/启停不用发版；新增任务类型只需部署一次带 `@JobHandler` 的代码。

## 写一个任务处理器

```ts
// modules/report/report.jobs.ts
import { Injectable } from '@nestjs/common';
import { JobHandler, JobContext } from '../job/job-registry';
import { PrismaService } from '../../core/prisma/prisma.service';

@JobHandler('report.dailyStats')          // 全局唯一 key
@Injectable()
export class DailyStatsJob implements JobHandler {
  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: JobContext): Promise<string> {
    // ctx.params  = 任务配置的 JSON 参数
    // ctx.logger  = AppLogger，用 ctx.logger.job/jobWarn/jobError 输出(写入当日日志 category=job)
    const count = await this.prisma.user.count();
    return `统计完成：当前用户 ${count} 人`;  // 返回值作为 result 记入本次执行记录
  }
}
```

把 class 注册进所在 Module 的 providers，完成。管理页即可创建使用该处理器的任务。

## 管理任务（页面 or API）

- `GET  /api/jobs` 任务列表；`GET /api/jobs/handlers` 可用处理器
- `POST /api/jobs` 新增（name / handlerKey / cronExpr / params(JSON) / misfirePolicy / timeoutSec）
- `PUT  /api/jobs/:id` 修改（**保存即生效，自动重建调度，无需重启**）
- `PUT  /api/jobs/:id/toggle` 启停
- `POST /api/jobs/:id/run` 立即执行一次（不占调度位，适合验证）
- `GET  /api/jobs/logs?jobId=&date=&status=` 执行历史（读当日日志文件：状态/耗时/结果/错误堆栈）

## cron 表达式（标准 5 段：分 时 日 月 周）

| 表达式 | 含义 |
|---|---|
| `0 * * * *` | 每小时整点 |
| `0 3 * * *` | 每天 03:00 |
| `*/5 * * * *` | 每 5 分钟 |
| `0 9 * * 1-5` | 工作日 09:00 |
| `0 0 1 * *` | 每月 1 号零点 |

保存时自动做合法性校验，非法表达式直接 400。

## 执行保障

| 机制 | 说明 |
|---|---|
| 分布式锁 | 每次执行先抢 `job:run:{id}` 锁（Redis SET NX PX / DB 行锁），多实例部署同一任务同一时刻只有一个实例真正执行，抢不到记 `SKIPPED_LOCK` |
| 超时强杀 | `timeoutSec`（默认 300s），Promise.race 超时记 `TIMEOUT` |
| misfire 策略 | 服务重启错过触发窗口时：`SKIP` 跳过 / `RUN_ONCE` 补跑一次 |
| handler 失效 | 部署回滚导致处理器缺失：任务自动暂停并在列表标红"未注册" |
| 执行记录 | 每次执行写一条 `category=job, event=run` 日志（SUCCESS→INFO / SKIPPED_LOCK→WARN / FAILED、TIMEOUT→ERROR），不落库 |

## 内置任务

| 任务 | key | 默认 cron | 说明 |
|---|---|---|---|
| 系统数据清理 | `system.cleanup` | `0 * * * *` | 清理过期锁、过期 refreshToken（日志文件按 `LOG_KEEP_DAYS` 自动清理） |
| 示例-每日问候 | `example.hello` | `0 3 * * *` | 演示用，可删除 |

## 注意事项

- handler key 全局唯一，重复注册启动直接报错（快速暴露冲突）
- `run()` 尽量幂等：补跑/misfire 场景可能重复执行
- 重活（大报表、批处理）建议在 handler 内部再分页处理，并控制 timeoutSec 合理值

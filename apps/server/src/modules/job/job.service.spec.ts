import { ConfigService } from '@nestjs/config';
import { JOB_HANDLERS } from './job-registry';
import { JobService } from './job.service';

const KEY = 'spec.job.service';

function setup(opts: { handler: () => Promise<unknown>; lock?: boolean; timeoutSec?: number }) {
  const job = {
    id: 1,
    name: '测试任务',
    handlerKey: KEY,
    cronExpr: '0 * * * *',
    params: { a: 1 },
    status: 'ENABLED',
    timeoutSec: opts.timeoutSec ?? 5,
  };
  const prisma: any = { job: { findUnique: jest.fn().mockResolvedValue(job), update: jest.fn(), findMany: jest.fn() } };
  const logger = { job: jest.fn(), jobWarn: jest.fn(), jobError: jest.fn(), newTraceId: () => 'trace' };
  const release = jest.fn().mockResolvedValue(undefined);
  const lock = { acquire: jest.fn().mockResolvedValue(opts.lock === false ? null : release) };
  const handler = { run: jest.fn(opts.handler) };
  const moduleRef = { get: jest.fn().mockReturnValue(handler) };
  const logReader = { query: jest.fn().mockResolvedValue({ list: [], total: 0 }) };
  const service = new JobService(
    prisma as any,
    logger as any,
    lock as any,
    moduleRef as any,
    { doesExist: () => false, deleteCronJob: jest.fn(), addCronJob: jest.fn() } as any,
    new ConfigService({}),
    logReader as any,
  );
  return { service, prisma, logger, lock, release, handler, logReader };
}

describe('JobService.run（执行记录写日志文件）', () => {
  beforeAll(() => JOB_HANDLERS.set(KEY, class {}));
  afterAll(() => JOB_HANDLERS.delete(KEY));

  it('成功：INFO 记录 event=run/SUCCESS，释放锁，更新上次/下次执行时间', async () => {
    const { service, logger, release, prisma, handler } = setup({ handler: async () => '处理 3 条' });

    const res = await service.run(1, 'manual');

    expect(res).toMatchObject({ skipped: false, status: 'SUCCESS', result: '处理 3 条' });
    expect(handler.run).toHaveBeenCalledWith(expect.objectContaining({ jobId: 1, params: { a: 1 } }));
    expect(logger.job).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'run', jobId: 1, status: 'SUCCESS', trigger: 'manual', result: '处理 3 条' }),
      expect.any(String),
    );
    expect(release).toHaveBeenCalled();
    expect(prisma.job.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { prevRunAt: expect.any(Date), nextRunAt: expect.any(Date) },
    });
  });

  it('失败：ERROR 记录错误堆栈，仍释放锁', async () => {
    const { service, logger, release } = setup({
      handler: async () => {
        throw new Error('下游超时');
      },
    });

    const res = await service.run(1, 'cron');

    expect(res.status).toBe('FAILED');
    expect(logger.jobError).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'run', status: 'FAILED', error: expect.stringContaining('下游超时') }),
      expect.any(String),
    );
    expect(release).toHaveBeenCalled();
  });

  it('超时：ERROR 记录 TIMEOUT，且不释放锁（防止仍在运行的 handler 被并发重入）', async () => {
    const { service, logger, release } = setup({ handler: () => new Promise(() => undefined), timeoutSec: 0.05 });

    const res = await service.run(1, 'cron');

    expect(res.status).toBe('TIMEOUT');
    expect(logger.jobError).toHaveBeenCalledWith(expect.objectContaining({ status: 'TIMEOUT' }), expect.any(String));
    expect(release).not.toHaveBeenCalled();
  });

  it('抢锁失败：WARN 记录 SKIPPED_LOCK，不执行 handler', async () => {
    const { service, logger, handler } = setup({ handler: async () => 'x', lock: false });

    const res = await service.run(1, 'cron');

    expect(res).toMatchObject({ skipped: true, status: 'SKIPPED_LOCK' });
    expect(handler.run).not.toHaveBeenCalled();
    expect(logger.jobWarn).toHaveBeenCalledWith(expect.objectContaining({ event: 'run', status: 'SKIPPED_LOCK' }), expect.any(String));
  });

  it('定时触发但库里已暂停（其他实例改的）→ 跳过，不抢锁不执行', async () => {
    const { service, prisma, lock, handler } = setup({ handler: async () => 'x' });
    prisma.job.findUnique.mockResolvedValue({ id: 1, status: 'PAUSED', handlerKey: KEY, cronExpr: '0 * * * *' });
    const res = await service.run(1, 'cron');
    expect(res).toMatchObject({ skipped: true });
    expect(lock.acquire).not.toHaveBeenCalled();
    expect(handler.run).not.toHaveBeenCalled();
  });
});

describe('JobService.reconcile（多实例调度对账）', () => {
  beforeAll(() => JOB_HANDLERS.set(KEY, class {}));
  afterAll(() => JOB_HANDLERS.delete(KEY));

  function withScheduler() {
    const ctx = setup({ handler: async () => 'x' });
    const registry = new Map<string, { stop: () => void }>();
    (ctx.service as any).scheduler = {
      addCronJob: (name: string, job: any) => registry.set(name, job),
      doesExist: (_: string, name: string) => registry.has(name),
      deleteCronJob: (name: string) => {
        registry.get(name)?.stop();
        registry.delete(name);
      },
    };
    (ctx.prisma.job as any).findMany = jest.fn();
    return { ...ctx, registry };
  }

  it('库里启用的任务注册调度；cron 变化时重建；暂停/删除的注销', async () => {
    const { service, prisma, registry } = withScheduler();
    prisma.job.findMany.mockResolvedValue([{ id: 1, status: 'ENABLED', cronExpr: '0 * * * *', handlerKey: KEY }]);
    await service.reconcile();
    expect(registry.has('job-1')).toBe(true);

    const before = registry.get('job-1');
    prisma.job.findMany.mockResolvedValue([{ id: 1, status: 'ENABLED', cronExpr: '*/5 * * * *', handlerKey: KEY }]);
    await service.reconcile();
    expect(registry.get('job-1')).not.toBe(before); // 已按新 cron 重建

    prisma.job.findMany.mockResolvedValue([{ id: 1, status: 'PAUSED', cronExpr: '*/5 * * * *', handlerKey: KEY }]);
    await service.reconcile();
    expect(registry.has('job-1')).toBe(false);
    registry.forEach((j) => j.stop());
  });
});

describe('JobService.logs（读日志文件）', () => {
  it('按 category=job + event=run 查询，并按 jobId/status 精确过滤', async () => {
    const { service, logReader } = setup({ handler: async () => 'x' });

    await service.logs({ jobId: 1, status: 'FAILED', date: '2026-09-30', page: 1, pageSize: 10 });

    const q = logReader.query.mock.calls[0][0];
    expect(q).toMatchObject({ date: '2026-09-30', category: 'job', keyword: '"event":"run"', page: 1, pageSize: 10 });
    expect(q.match({ jobId: 1, status: 'FAILED' })).toBe(true);
    expect(q.match({ jobId: 2, status: 'FAILED' })).toBe(false);
    expect(q.match({ jobId: 1, status: 'SUCCESS' })).toBe(false);
  });
});

describe('JobService：每次触发只执行一次 / 手动执行不阻塞请求', () => {
  beforeAll(() => JOB_HANDLERS.set(KEY, class {}));
  afterAll(() => JOB_HANDLERS.delete(KEY));

  it('定时触发：本次触发已被其他实例认领 → 跳过（SKIPPED_DUP），不执行、不记 WARN', async () => {
    const { service, lock, handler, logger } = setup({ handler: async () => 'x' });
    lock.acquire.mockResolvedValueOnce(null); // 认领 job:fire:* 失败
    const res = await service.run(1, 'cron', new Date('2026-01-01T00:00:00Z'));
    expect(res).toMatchObject({ skipped: true, status: 'SKIPPED_DUP' });
    expect(lock.acquire).toHaveBeenCalledWith(`job:fire:1:${Date.parse('2026-01-01T00:00:00Z')}`, expect.any(Number));
    expect(handler.run).not.toHaveBeenCalled();
    expect(logger.jobWarn).not.toHaveBeenCalled();
  });

  it('定时触发：认领成功后再抢执行锁并执行；认领记录不释放（防止时钟稍慢的实例重复执行）', async () => {
    const claimRelease = jest.fn();
    const { service, lock, handler, release } = setup({ handler: async () => 'ok' });
    lock.acquire.mockResolvedValueOnce(claimRelease); // 认领
    const res = await service.run(1, 'cron', new Date());
    expect(res.status).toBe('SUCCESS');
    expect(handler.run).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalled(); // 执行锁释放
    expect(claimRelease).not.toHaveBeenCalled(); // 认领记录保留
  });

  it('手动执行：快任务直接返回结果', async () => {
    const { service } = setup({ handler: async () => 'done' });
    await expect(service.runOnce(1)).resolves.toMatchObject({ status: 'SUCCESS', result: 'done' });
  });

  it('手动执行：慢任务 5 秒后返回 RUNNING，任务继续在后台执行', async () => {
    jest.useFakeTimers();
    try {
      let finish!: (v: string) => void;
      const { service, logger } = setup({ handler: () => new Promise<string>((r) => (finish = r)), timeoutSec: 60 });
      const pending = service.runOnce(1);
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toEqual({ status: 'RUNNING' });
      finish('later');
      await jest.advanceTimersByTimeAsync(0);
      expect(logger.job).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCESS', result: 'later' }), expect.any(String));
    } finally {
      jest.useRealTimers();
    }
  });
});

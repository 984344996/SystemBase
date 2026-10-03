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
  const prisma = { job: { findUnique: jest.fn().mockResolvedValue(job), update: jest.fn() } };
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
    {} as any,
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

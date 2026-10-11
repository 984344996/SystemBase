import { MonitorService } from './monitor.service';
import { LogReaderService } from '../../core/logger/log-reader.service';

/** 只关心「传给 reader 的过滤条件」，不真的读文件 */
function setup() {
  const reader = {
    listFiles: jest.fn().mockResolvedValue(['2026-10-02', '2026-10-01']),
    existingFile: jest.fn().mockReturnValue('/logs/app.2026-10-02.log'),
    query: jest.fn().mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 10 }),
  };
  const service = new MonitorService(reader as unknown as LogReaderService);
  return { service, reader };
}

describe('MonitorService', () => {
  it('dates() 直接返回可用日志日期列表', async () => {
    const { service } = setup();
    await expect(service.dates()).resolves.toEqual(['2026-10-02', '2026-10-01']);
  });

  it('logs() 透传日期/级别/分类/关键字/traceId', async () => {
    const { service, reader } = setup();
    await service.logs({ date: '2026-10-02', level: 'ERROR', category: 'access', keyword: 'timeout', traceId: 'abc', page: 2, pageSize: 20 } as never);
    expect(reader.query).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-10-02',
        level: 'ERROR',
        category: 'access',
        keyword: 'timeout',
        traceId: 'abc',
        page: 2,
        pageSize: 20,
      }),
    );
  });

  it('loginLogs()：限定 category=audit 且 event=login', async () => {
    const { service, reader } = setup();
    await service.loginLogs({ date: '2026-10-02' } as never);
    const arg = reader.query.mock.calls[0][0];
    expect(arg.category).toBe('audit');
    expect(arg.match({ event: 'login', username: 'admin', success: true })).toBe(true);
    expect(arg.match({ event: 'operate', username: 'admin', success: true })).toBe(false);
  });

  it('loginLogs()：按用户名关键字与成功与否过滤', async () => {
    const { service, reader } = setup();
    await service.loginLogs({ keyword: 'adm', success: 'false' } as never);
    const arg = reader.query.mock.calls[0][0];
    expect(arg.match({ event: 'login', username: 'admin', success: false })).toBe(true);
    expect(arg.match({ event: 'login', username: 'zhangsan', success: false })).toBe(false); // 关键字不匹配
    expect(arg.match({ event: 'login', username: 'admin', success: true })).toBe(false); // success 过滤
  });

  it('operateLogs()：限定 event=operate，按模块与多字段关键字过滤', async () => {
    const { service, reader } = setup();
    await service.operateLogs({ keyword: '用户', module: '用户管理' } as never);
    const arg = reader.query.mock.calls[0][0];
    expect(arg.category).toBe('audit');
    expect(arg.match({ event: 'operate', module: '用户管理', action: '删除用户', username: 'admin', success: true })).toBe(true);
    expect(arg.match({ event: 'operate', module: '角色管理', action: '删除角色', username: 'admin', success: true })).toBe(false); // 模块不符
    expect(arg.match({ event: 'login', username: 'admin', success: true })).toBe(false); // 事件不符
  });

  it('downloadPath() 返回当日（或指定日期）日志文件', () => {
    const { service, reader } = setup();
    expect(service.downloadPath('2026-10-02')).toBe('/logs/app.2026-10-02.log');
    expect(reader.existingFile).toHaveBeenCalledWith('2026-10-02', 'server');
    // 前端日志（web.*.log）走 source=client
    expect(service.downloadPath('2026-10-02', 'client')).toBe('/logs/app.2026-10-02.log');
    expect(reader.existingFile).toHaveBeenCalledWith('2026-10-02', 'client');
  });
});

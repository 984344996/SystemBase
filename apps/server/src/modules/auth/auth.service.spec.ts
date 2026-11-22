import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { LoginGuardService } from '../../core/security/login-guard.service';
import { localStore } from '../../core/redis/testing';
import { SessionRevocationService } from '../../core/security/session-revocation.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const req = { ip: '10.0.0.8', headers: { 'user-agent': 'jest' } } as any;
const PASSWORD_HASH = bcrypt.hashSync('secret123', 4);

function setup() {
  const prisma: any = {
    user: { findFirst: jest.fn(), update: jest.fn() },
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  prisma.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const logger = { audit: jest.fn(), warn: jest.fn(), warnFields: jest.fn() };
  const permCache = { invalidateUser: jest.fn() };
  const guard = new LoginGuardService(new ConfigService({}), logger as any, localStore());
  const revocation = new SessionRevocationService(new ConfigService({ JWT_EXPIRES_IN: '2h' }), localStore());
  const service = new AuthService(
    prisma as any,
    jwt as any,
    new ConfigService({ JWT_REFRESH_EXPIRES_IN: '7d', JWT_REFRESH_ABSOLUTE_MAX: '30d' }),
    logger as any,
    permCache as any,
    guard,
    revocation,
  );
  return { service, prisma, jwt, logger, permCache, guard, revocation };
}

const activeUser = {
  id: 1, username: 'admin', name: '管理员', password: PASSWORD_HASH,
  status: 'ENABLED', deletedAt: null, mustChangePassword: false, pwdUpdatedAt: new Date(),
};

describe('AuthService.login', () => {
  it('成功：签发 token，并写 INFO 级登录审计', async () => {
    const { service, prisma, logger, jwt } = setup();
    prisma.user.findFirst.mockResolvedValue(activeUser);

    const res = await service.login({ username: 'admin', password: 'secret123' }, req);

    expect(res.accessToken).toBe('access-token');
    expect(res.refreshToken).toMatch(/^[0-9a-f]{96}$/);
    // 数据库只存 refreshToken 的哈希
    const created = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(created.tokenHash).toBe(sha256(res.refreshToken));
    // 登录开启新会话：accessToken 带 sid，与 refreshToken 的 sessionId 一致
    expect(created.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: 1, sid: created.sessionId }));
    expect(logger.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login', success: true, username: 'admin', ip: '10.0.0.8' }),
      expect.any(String),
      'info',
    );
  });

  it.each([
    ['密码错误', activeUser, 'wrong-pass'],
    ['账号已禁用', { ...activeUser, status: 'DISABLED' }, 'secret123'],
    ['账号不存在', null, 'secret123'],
  ])('失败（%s）：对外统一提示，日志记录真实原因(WARN)', async (reason, user, password) => {
    const { service, prisma, logger } = setup();
    prisma.user.findFirst.mockResolvedValue(user);

    await expect(service.login({ username: 'admin', password }, req)).rejects.toThrow(
      new UnauthorizedException('用户名或密码错误'),
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(logger.audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'login', success: false, reason }),
      expect.any(String),
      'warn',
    );
  });
});

describe('AuthService.refresh', () => {
  const record = (patch: Record<string, unknown> = {}) => ({
    id: 9,
    userId: 1,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    sessionId: 's'.repeat(32),
    sessionStartedAt: new Date(Date.now() - 3_600_000),
    user: activeUser,
    ...patch,
  });

  it('轮换沿用原会话：sessionId / 会话开始时间不变', async () => {
    const { service, prisma, jwt } = setup();
    const r = record();
    prisma.refreshToken.findUnique.mockResolvedValue(r);
    await service.refresh('old-token', req);
    const created = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(created.sessionId).toBe(r.sessionId);
    expect(created.sessionStartedAt).toEqual(r.sessionStartedAt);
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sid: r.sessionId }));
  });

  it('绝对过期上限：新 refreshToken 的有效期不超过「登录时间 + JWT_REFRESH_ABSOLUTE_MAX」', async () => {
    const { service, prisma } = setup();
    // 会话已持续 29 天：本次轮换按 7 天算会超过 30 天上限 → 截断到第 30 天
    const startedAt = new Date(Date.now() - 29 * 86_400_000);
    prisma.refreshToken.findUnique.mockResolvedValue(record({ sessionStartedAt: startedAt }));
    await service.refresh('old-token', req);
    const { expiresAt } = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(expiresAt.getTime()).toBe(startedAt.getTime() + 30 * 86_400_000);
  });

  it('轮换：条件作废旧 token（revokedAt: null）并在同一事务内签发新 token 对', async () => {
    const { service, prisma } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(record());

    const res = await service.refresh('old-token', req);

    expect(prisma.refreshToken.findUnique.mock.calls[0][0].where.tokenHash).toBe(sha256('old-token'));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 9, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    expect(res.refreshToken).not.toBe('old-token');
  });

  it('并发：另一请求已抢先轮换（条件更新 count=0）→ 401，不签发新 token', async () => {
    const { service, prisma } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(record());
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh('old-token', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('宽限期：刚被轮换（30s 内）的 token 再次出现 → 401 但不吊销全部登录态（多标签页并发刷新）', async () => {
    const { service, prisma, logger } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(record({ revokedAt: new Date(Date.now() - 5_000) }));
    await expect(service.refresh('reused', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(logger.audit).not.toHaveBeenCalled();
  });

  it('重放：作废超过宽限期的 token 再次使用 → 吊销该用户全部登录态 + WARN 审计', async () => {
    const { service, prisma, logger, revocation } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(record({ revokedAt: new Date(Date.now() - 60_000) }));
    // 模拟 Prisma 的惰性查询：只有被 await / then 时才真正执行（只断言「调用过」发现不了漏写 await）
    const executed = jest.fn();
    prisma.refreshToken.updateMany.mockReturnValue({
      then: (resolve: (v: unknown) => void) => {
        executed();
        resolve({ count: 2 });
      },
    });

    await expect(service.refresh('reused', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(executed).toHaveBeenCalled();
    // 此前签发的 accessToken 也立即失效（攻击者手里的 token）
    await expect(revocation.revokedReason(1, undefined, Math.floor(Date.now() / 1000) - 10)).resolves.toBeTruthy();
    expect(logger.audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'token_replay' }), expect.any(String), 'warn');
  });

  it('会话已整体结束（登出 / 改密）后旧 token 再出现：401，但不判定为重放（不吊销其他设备）', async () => {
    const { service, prisma, logger } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(record({ revokedAt: new Date(Date.now() - 60_000) }));
    prisma.refreshToken.count.mockResolvedValue(0);
    await expect(service.refresh('stale', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(logger.audit).not.toHaveBeenCalled();
  });

  it.each([
    ['已过期', record({ expiresAt: new Date(Date.now() - 1) })],
    ['用户已禁用', record({ user: { ...activeUser, status: 'DISABLED' } })],
    ['用户已删除', record({ user: { ...activeUser, deletedAt: new Date() } })],
    ['token 不存在', null],
  ])('拒绝：%s', async (_, rec) => {
    const { service, prisma } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(rec);
    await expect(service.refresh('t', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.updateProfile', () => {
  it('空串视为清空，并失效权限缓存（姓名随之刷新）', async () => {
    const { service, prisma, permCache } = setup();
    prisma.user.findFirst.mockResolvedValue({ ...activeUser, phone: null, email: null, roles: [] });
    const authUser = { id: 1, username: 'admin', name: '管理员', roles: [], permissions: [], mustChangePassword: false, pwdUpdatedAt: 0 };

    await service.updateProfile(authUser, { name: '新名字', phone: '', email: '' });

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: '新名字', phone: null, email: null } });
    expect(permCache.invalidateUser).toHaveBeenCalledWith(1);
  });
});

describe('AuthService.logout', () => {
  it('吊销整个会话：会话内 refreshToken 全部作废 + 该会话的 accessToken 立即失效', async () => {
    const { service, prisma, revocation } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue({ sessionId: 'abc' });
    await expect(service.logout('rt')).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 'abc', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    await expect(revocation.revokedReason(1, 'abc', Math.floor(Date.now() / 1000))).resolves.toBe('已退出登录，请重新登录');
    // 其他会话（其他设备）不受影响
    await expect(revocation.revokedReason(1, 'other', Math.floor(Date.now() / 1000))).resolves.toBeNull();
  });

  it('token 不存在：直接返回成功（不报错，避免探测）', async () => {
    const { service, prisma } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.logout('unknown')).resolves.toEqual({ success: true });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.changePassword（原密码防暴力尝试）', () => {
  const me = { id: 1, username: 'admin' } as any;

  it('原密码连续错误达到阈值后锁定：之后即使原密码正确也返回 429（与登录共用计数）', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique = jest.fn().mockResolvedValue(activeUser);
    for (let i = 0; i < 5; i++) {
      await expect(service.changePassword(me, 'wrong', 'NewPass123', '10.0.0.8')).rejects.toThrow('原密码不正确');
    }
    await expect(service.changePassword(me, 'secret123', 'NewPass123', '10.0.0.8')).rejects.toMatchObject({ status: 429 });
    // 被猜的是同一账号的密码：登录同样被锁
    await expect(service.login({ username: 'admin', password: 'secret123' }, req)).rejects.toMatchObject({ status: 429 });
  });

  it('原密码正确：改密成功并清空失败计数', async () => {
    const { service, prisma, guard } = setup();
    prisma.user.findUnique = jest.fn().mockResolvedValue(activeUser);
    await expect(service.changePassword(me, 'wrong', 'NewPass123', '10.0.0.8')).rejects.toThrow('原密码不正确');
    const clear = jest.spyOn(guard, 'clearFailures');
    await expect(service.changePassword(me, 'secret123', 'NewPass123', '10.0.0.8')).resolves.toEqual({ success: true });
    expect(clear).toHaveBeenCalledWith('admin', '10.0.0.8');
  });
});

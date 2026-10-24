import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { LoginGuardService } from '../../core/security/login-guard.service';

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
    },
  };
  prisma.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
  const logger = { audit: jest.fn(), warn: jest.fn() };
  const permCache = { invalidateUser: jest.fn() };
  const guard = new LoginGuardService(new ConfigService({}), logger as any);
  const service = new AuthService(
    prisma as any,
    jwt as any,
    new ConfigService({ JWT_REFRESH_EXPIRES_IN: '7d' }),
    logger as any,
    permCache as any,
    guard,
  );
  return { service, prisma, jwt, logger, permCache, guard };
}

const activeUser = {
  id: 1, username: 'admin', name: '管理员', password: PASSWORD_HASH,
  status: 'ENABLED', deletedAt: null, mustChangePassword: false, pwdUpdatedAt: new Date(),
};

describe('AuthService.login', () => {
  it('成功：签发 token，并写 INFO 级登录审计', async () => {
    const { service, prisma, logger } = setup();
    prisma.user.findFirst.mockResolvedValue(activeUser);

    const res = await service.login({ username: 'admin', password: 'secret123' }, req);

    expect(res.accessToken).toBe('access-token');
    expect(res.refreshToken).toMatch(/^[0-9a-f]{96}$/);
    // 数据库只存 refreshToken 的哈希
    expect(prisma.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(sha256(res.refreshToken));
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
    user: activeUser,
    ...patch,
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
    const { service, prisma, logger } = setup();
    prisma.refreshToken.findUnique.mockResolvedValue(record({ revokedAt: new Date(Date.now() - 60_000) }));

    await expect(service.refresh('reused', req)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(logger.audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'token_replay' }), expect.any(String), 'warn');
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

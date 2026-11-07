import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PermissionCacheService } from './permission-cache.service';
import { localEventBus } from '../redis/testing';

/** 数据库里的用户（含启用的角色与菜单权限） */
function dbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: 'alice',
    name: 'Alice',
    status: 'ENABLED',
    mustChangePassword: false,
    pwdUpdatedAt: new Date('2026-01-01T00:00:00Z'),
    roles: [
      { role: { code: 'editor', menus: [{ menu: { permission: 'a:list' } }, { menu: { permission: 'a:update' } }, { menu: { permission: null } }] } },
      { role: { code: 'viewer', menus: [{ menu: { permission: 'a:list' } }] } },
    ],
    ...overrides,
  };
}

function setup(ttl = '30') {
  const prisma = { user: { findFirst: jest.fn().mockResolvedValue(dbUser()) } };
  const cache = new PermissionCacheService({ get: () => ttl } as unknown as ConfigService, localEventBus());
  // 直接给定密钥（不用 ConfigService：它优先读 process.env，而导入 Prisma 时会加载本机 .env）
  const config = { get: () => 'x'.repeat(32) } as unknown as ConfigService;
  const strategy = new JwtStrategy(config, prisma as any, cache);
  return { strategy, prisma, cache };
}

const iatAfterPwdChange = Date.parse('2026-02-01T00:00:00Z') / 1000;

describe('JwtStrategy.validate', () => {
  it('加载角色与权限：权限码去重、忽略空权限码', async () => {
    const { strategy } = setup();
    const u = await strategy.validate({ sub: 7, username: 'alice', name: 'Alice', iat: iatAfterPwdChange });
    expect(u.roles).toEqual(['editor', 'viewer']);
    expect(u.permissions.sort()).toEqual(['a:list', 'a:update']);
  });

  it('TTL 内命中缓存不再查库；用户失效后重新查库', async () => {
    const { strategy, prisma, cache } = setup();
    const p = { sub: 7, username: 'alice', name: 'Alice', iat: iatAfterPwdChange };
    await strategy.validate(p);
    await strategy.validate(p);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    cache.invalidateUser(7);
    await strategy.validate(p);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it('关闭缓存（TTL=0）时每次都查库', async () => {
    const { strategy, prisma } = setup('0');
    const p = { sub: 7, username: 'alice', name: 'Alice', iat: iatAfterPwdChange };
    await strategy.validate(p);
    await strategy.validate(p);
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(2);
  });

  it('改密前签发的 token 被拒（401），改密后签发的放行', async () => {
    const { strategy } = setup();
    const before = Date.parse('2025-12-31T00:00:00Z') / 1000;
    await expect(strategy.validate({ sub: 7, username: 'alice', name: 'Alice', iat: before })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate({ sub: 7, username: 'alice', name: 'Alice', iat: iatAfterPwdChange })).resolves.toBeTruthy();
  });

  it('改密请求本身签发的 token 与改密时间同一秒：允许 1 秒误差', async () => {
    const { strategy } = setup();
    const sameSecond = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000);
    await expect(strategy.validate({ sub: 7, username: 'alice', name: 'Alice', iat: sameSecond })).resolves.toBeTruthy();
  });

  it.each([
    ['已删除/不存在', null],
    ['已禁用', dbUser({ status: 'DISABLED' })],
  ])('账号%s → 401', async (_label, row) => {
    const { strategy, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue(row);
    await expect(strategy.validate({ sub: 7, username: 'alice', name: 'Alice' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { IpFilterMiddleware } from './ip-filter.middleware';

/** 按给定白/黑名单构造中间件（中间件在构造时读取环境变量） */
function create(whitelist = '', blacklist = ''): IpFilterMiddleware {
  process.env.IP_WHITELIST = whitelist;
  process.env.IP_BLACKLIST = blacklist;
  return new IpFilterMiddleware();
}

/** 执行中间件：放行返回 true，拒绝抛 ForbiddenException */
function pass(mw: IpFilterMiddleware, ip: string, url = '/api/users'): boolean {
  let called = false;
  mw.use({ ip, originalUrl: url }, undefined, () => {
    called = true;
  });
  return called;
}

describe('IpFilterMiddleware', () => {
  const saved = { w: process.env.IP_WHITELIST, b: process.env.IP_BLACKLIST };
  afterAll(() => {
    process.env.IP_WHITELIST = saved.w;
    process.env.IP_BLACKLIST = saved.b;
  });

  it('未配置名单时全部放行', () => {
    expect(pass(create(), '8.8.8.8')).toBe(true);
  });

  it('白名单：精确与前缀通配放行，其他拒绝', () => {
    const mw = create('1.2.3.4,192.168.*');
    expect(pass(mw, '1.2.3.4')).toBe(true);
    expect(pass(mw, '192.168.10.2')).toBe(true);
    expect(() => pass(mw, '8.8.8.8')).toThrow(ForbiddenException);
  });

  it('IPv4-mapped IPv6 地址按 IPv4 匹配', () => {
    expect(pass(create('1.2.3.4'), '::ffff:1.2.3.4')).toBe(true);
  });

  it('黑名单优先于白名单', () => {
    expect(() => pass(create('1.2.3.*', '1.2.3.4'), '1.2.3.4')).toThrow(ForbiddenException);
  });

  it('本机健康检查不受白名单限制（发布脚本探活）', () => {
    const mw = create('1.2.3.4');
    expect(pass(mw, '127.0.0.1', '/api/health')).toBe(true);
    expect(pass(mw, '::ffff:127.0.0.1', '/api/health/ready')).toBe(true);
    expect(pass(mw, '::1', '/api/health?x=1')).toBe(true);
  });

  it('本机访问非健康检查接口、或外部访问健康检查，仍按白名单拒绝', () => {
    const mw = create('1.2.3.4');
    expect(() => pass(mw, '127.0.0.1', '/api/users')).toThrow(ForbiddenException);
    expect(() => pass(mw, '127.0.0.1', '/api/healthx')).toThrow(ForbiddenException);
    expect(() => pass(mw, '8.8.8.8', '/api/health')).toThrow(ForbiddenException);
  });
});

import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';

/**
 * IP 白/黑名单中间件。
 *
 *   IP_WHITELIST  逗号分隔，配置了则只允许列表内访问（空 = 不限制）
 *   IP_BLACKLIST  逗号分隔，列表内一律拒绝（优先级高于白名单）
 *
 * 规则支持：精确 IP（1.2.3.4）、前缀通配（192.168.*）、IPv6 精确匹配。
 * 真实 IP 由 express 的 trust proxy（TRUST_PROXY）解析，反代后无需额外处理。
 * 例外：来自本机（127.0.0.1 / ::1）的健康检查 /api/health* 不受白名单限制——发布脚本与运维探活
 * 都走本机，否则配置白名单后每次发布都会因健康检查失败而自动回滚。外部监控机器仍需加入白名单。
 */
@Injectable()
export class IpFilterMiddleware implements NestMiddleware {
  private readonly whitelist: string[];
  private readonly blacklist: string[];

  constructor() {
    this.whitelist = split(process.env.IP_WHITELIST);
    this.blacklist = split(process.env.IP_BLACKLIST);
  }

  use(req: { ip?: string; originalUrl?: string; url?: string }, _res: unknown, next: () => void): void {
    const ip = normalize(req.ip || '');
    if (!ip) return next();
    if (match(ip, this.blacklist)) throw new ForbiddenException('当前 IP 已被禁止访问');
    if (isLoopback(ip) && isHealthPath(req.originalUrl ?? req.url ?? '')) return next();
    if (this.whitelist.length && !match(ip, this.whitelist)) throw new ForbiddenException('当前 IP 不在允许访问的名单内');
    next();
  }
}

/** 本机地址（normalize 后 IPv4-mapped 已还原为 IPv4） */
function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1';
}

/** 健康检查路径：/api/health、/api/health/live、/api/health/ready（可带查询串） */
function isHealthPath(url: string): boolean {
  return /^\/(?:api\/)?health(?:[/?]|$)/.test(url);
}

function split(v: string | undefined): string[] {
  return (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** IPv4-mapped IPv6（::ffff:1.2.3.4）还原为 IPv4 */
function normalize(ip: string): string {
  const v = ip.trim();
  if (v.startsWith('::ffff:') && v.includes('.')) return v.slice(7);
  return v;
}

function match(ip: string, rules: string[]): boolean {
  for (const rule of rules) {
    if (rule === ip) return true;
    if (rule.endsWith('*')) {
      const prefix = rule.slice(0, -1);
      if (prefix && ip.startsWith(prefix)) return true;
    }
  }
  return false;
}

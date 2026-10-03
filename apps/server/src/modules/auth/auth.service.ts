import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Request } from 'express';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AppLogger } from '../../core/logger/logger.service';
import { AuthUser } from '../../core/security/jwt.strategy';
import { PermissionCacheService } from '../../core/security/permission-cache.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** "7d"/"12h"/"30m" -> 毫秒 */
export function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  /**
   * 用户不存在时也做一次同代价的 bcrypt 比较，抹平登录响应时间差，
   * 防止通过耗时差异枚举有效用户名（模块加载时计算一次）。
   */
  private static readonly DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
    private readonly permCache: PermissionCacheService,
  ) {}

  // ---------- 登录 ----------
  async login(dto: LoginDto, req: Request) {
    const user = await this.prisma.user.findFirst({ where: { username: dto.username, deletedAt: null } });
    // 无论用户是否存在都执行一次 bcrypt，避免通过响应时间枚举用户名
    const passwordOk = await bcrypt.compare(dto.password, user?.password ?? AuthService.DUMMY_HASH);
    const ok = !!user && user.status === 'ENABLED' && passwordOk;

    // 日志里记录具体原因便于排障；对外响应统一模糊提示，防止用户名枚举
    const reason = ok ? '登录成功' : !user ? '账号不存在' : user.status !== 'ENABLED' ? '账号已禁用' : '密码错误';
    this.auditLogin(user?.id, dto.username, ok, reason, req);
    if (!ok) throw new UnauthorizedException('用户名或密码错误');

    const pair = await this.issueTokens(user.id, user.username, user.name, req);
    return { ...pair, user: { id: user.id, username: user.username, name: user.name } };
  }

  // ---------- 刷新令牌（轮换：旧 refreshToken 用后即废） ----------
  async refresh(refreshToken: string, req: Request) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException('登录已过期，请重新登录');

    // 重放检测：已作废的 refreshToken 再次出现（疑似泄露），吊销该用户全部登录态，强制全端重登
    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.audit(
        { event: 'token_replay', userId: record.userId, username: record.user.username, ip: req.ip, ua: this.ua(req) },
        `已作废的 refreshToken 被重复使用，疑似泄露，已吊销用户 ${record.user.username} 全部登录态`,
        'warn',
      );
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const valid =
      record.expiresAt > new Date() &&
      record.user.deletedAt === null &&
      record.user.status === 'ENABLED';
    if (!valid) throw new UnauthorizedException('登录已过期，请重新登录');

    // 轮换：作废旧 token 再签发新对
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.user.id, record.user.username, record.user.name, req);
  }

  // ---------- 登出 ----------
  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  // ---------- 个人信息 ----------
  async profile(user: AuthUser) {
    const detail = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      include: { roles: { include: { role: { select: { code: true, name: true } } } } },
    });
    if (!detail) throw new UnauthorizedException('账号不存在');
    return {
      id: detail.id,
      username: detail.username,
      name: detail.name,
      phone: detail.phone,
      email: detail.email,
      roles: detail.roles.map((r) => r.role.name),
      roleCodes: detail.roles.map((r) => r.role.code),
      permissions: user.roles.includes('SUPER_ADMIN') ? ['*'] : user.permissions,
    };
  }

  // ---------- 修改自己的基本资料 ----------
  async updateProfile(user: AuthUser, dto: UpdateProfileDto) {
    const data: { name?: string; phone?: string | null; email?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    // 传空字符串视为清空（前端清空输入框时提交 ''）
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.email !== undefined) data.email = dto.email || null;
    await this.prisma.user.update({ where: { id: user.id }, data });
    this.permCache.invalidateUser(user.id); // 缓存里的姓名随之刷新
    return this.profile(user);
  }

  // ---------- 当前用户可见菜单（前端动态路由数据源） ----------
  async myMenus(user: AuthUser) {
    const isSuper = user.roles.includes('SUPER_ADMIN');
    const menus = await this.prisma.menu.findMany({
      where: { status: 'ENABLED', visible: true, type: { in: ['DIRECTORY', 'MENU'] } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    let visible = menus;
    if (!isSuper) {
      const roleIds = await this.prisma.userRole.findMany({ where: { userId: user.id }, select: { roleId: true } });
      const menuIds = await this.prisma.roleMenu.findMany({
        where: { roleId: { in: roleIds.map((r) => r.roleId) } },
        select: { menuId: true },
      });
      const allowed = new Set(menuIds.map((m) => m.menuId));
      visible = menus.filter((m) => allowed.has(m.id));
    }
    return this.buildTree(visible);
  }

  // ---------- 修改自己的密码 ----------
  async changePassword(user: AuthUser, oldPassword: string, newPassword: string) {
    const detail = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!detail || !(await bcrypt.compare(oldPassword, detail.password))) {
      throw new BadRequestException('原密码不正确');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(newPassword, 10) } }),
      // 全端踢下线：吊销所有 refreshToken
      this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { success: true };
  }

  // ---------- 内部 ----------
  private async issueTokens(userId: number, username: string, name: string, req: Request): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: userId, username, name });
    const refreshToken = randomBytes(48).toString('hex');
    const ttl = parseDuration(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttl),
        ip: req.ip,
        ua: this.ua(req),
      },
    });
    return { accessToken, refreshToken };
  }

  /** 登录审计：成功 INFO / 失败 WARN，写日志文件 category=audit event=login */
  private auditLogin(userId: number | undefined, username: string, success: boolean, reason: string, req: Request) {
    this.logger.audit(
      { event: 'login', success, userId, username: username.slice(0, 50), reason, ip: req.ip, ua: this.ua(req) },
      `${success ? '登录成功' : '登录失败'}: ${username.slice(0, 50)}${success ? '' : `（${reason}）`}`,
      success ? 'info' : 'warn',
    );
  }

  private ua(req: Request): string {
    return (req.headers['user-agent'] || '').slice(0, 250);
  }

  private buildTree(menus: { id: number; parentId: number | null }[]) {
    const map = new Map<number, any>();
    menus.forEach((m) => map.set(m.id, { ...m, children: [] }));
    const roots: any[] = [];
    map.forEach((node) => {
      const parent = node.parentId ? map.get(node.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    });
    // 递归剔除没有可访问子节点的空目录
    const prune = (nodes: any[]): any[] =>
      nodes.filter((n) => n.type === 'MENU' || (n.children.length > 0 && (n.children = prune(n.children))));
    return prune(roots);
  }
}

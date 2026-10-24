import {
  BadRequestException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Request } from 'express';
import { Menu } from '@prisma/client';
import { buildTree } from '@sb/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessException, BizCode } from '../../core/filter/business.exception';
import { AppLogger } from '../../core/logger/logger.service';
import { AuthUser } from '../../core/security/jwt.strategy';
import { PermissionCacheService } from '../../core/security/permission-cache.service';
import { isSuperAdmin } from '../../core/security/permissions.guard';
import { LoginGuardService } from '../../core/security/login-guard.service';
import { checkPasswordStrength, isPasswordExpired, readPasswordPolicy } from '../../core/security/password-policy';
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

/** 刚被轮换的 refreshToken 在该窗口内再次出现，视为并发刷新（多标签页/重试）而非泄露重放 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/**
 * 密码可用性校验（策略 + 不得与旧密码相同）：不通过直接抛 400，错误信息可直接展示给用户。
 * 管理员重置与用户自助改密共用同一套规则。bcrypt 比较用异步版本，不阻塞事件循环。
 */
export async function assertPasswordUsable(newPassword: string, username: string, oldHash?: string): Promise<void> {
  const problems = checkPasswordStrength(newPassword, username, readPasswordPolicy());
  if (problems.length) throw new BadRequestException(problems.join('；'));
  if (oldHash && (await bcrypt.compare(newPassword, oldHash))) {
    throw new BadRequestException('新密码不能与当前密码相同');
  }
}

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
    private readonly guard: LoginGuardService,
  ) {}

  // ---------- 登录 ----------
  async login(dto: LoginDto, req: Request) {
    const key = LoginGuardService.keyOf(dto.username, req.ip);
    this.guard.assertNotLocked(key); // 连续失败过多：直接拒绝（429）

    // 验证码：配置要求时必须校验（缺 id 时提示前端拉取验证码）
    if (this.guard.captchaRequired(key)) {
      const needCaptcha = !dto.captchaId || !this.guard.verifyCaptcha(dto.captchaId, dto.captchaCode || '');
      if (needCaptcha) {
        throw new BusinessException(
          BizCode.NEED_CAPTCHA,
          '请输入验证码',
          HttpStatus.PRECONDITION_FAILED,
          { needCaptcha: true },
        );
      }
    }

    const user = await this.prisma.user.findFirst({ where: { username: dto.username, deletedAt: null } });
    // 无论用户是否存在都执行一次 bcrypt，避免通过响应时间枚举用户名
    const passwordOk = await bcrypt.compare(dto.password, user?.password ?? AuthService.DUMMY_HASH);
    const ok = !!user && user.status === 'ENABLED' && passwordOk;

    // 日志里记录具体原因便于排障；对外响应统一模糊提示，防止用户名枚举
    const reason = ok ? '登录成功' : !user ? '账号不存在' : user.status !== 'ENABLED' ? '账号已禁用' : '密码错误';
    if (!ok) {
      this.guard.recordFailure(key); // 失败计数（达到阈值则锁定）
      this.auditLogin(user?.id, dto.username, false, reason, req);
      throw new UnauthorizedException('用户名或密码错误');
    }
    this.guard.clearFailures(key);
    this.auditLogin(user.id, dto.username, true, '登录成功', req);

    const pair = await this.issueTokens(user.id, user.username, user.name, req);
    return {
      ...pair,
      user: { id: user.id, username: user.username, name: user.name },
      // 前端据此跳强制改密页；密码过期时提示尽快修改（不阻断，但前端会提示）
      mustChangePassword: user.mustChangePassword,
      passwordExpired: isPasswordExpired(user.pwdUpdatedAt),
    };
  }

  /** 签发登录验证码（LOGIN_CAPTCHA=off 或未安装 svg-captcha 时返回 null） */
  captcha() {
    return this.guard.issueCaptcha();
  }

  // ---------- 刷新令牌（轮换：旧 refreshToken 用后即废） ----------
  /**
   * 并发安全：
   * - 作废旧 token 用条件更新 `updateMany({ id, revokedAt: null })`，只有一个请求能抢到（count===1），
   *   作废与签发新 token 在同一事务内，签发失败时旧 token 不会被白白作废
   * - 宽限期：刚被轮换（REFRESH_REUSE_GRACE_MS 内）的 token 再次出现，视为多标签页/网络重试的并发刷新，
   *   返回 401 让客户端改用最新 token，而不是当作「token 泄露」吊销全部登录态
   * - 超过宽限期仍被使用才判定为重放（疑似泄露），吊销该用户全部 refreshToken
   */
  async refresh(refreshToken: string, req: Request) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException('登录已过期，请重新登录');

    if (record.revokedAt) {
      this.handleRevokedReuse(record, req);
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    const valid =
      record.expiresAt > new Date() &&
      record.user.deletedAt === null &&
      record.user.status === 'ENABLED';
    if (!valid) throw new UnauthorizedException('登录已过期，请重新登录');

    const pair = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) return null; // 并发请求已抢先轮换
      return this.issueTokens(record.user.id, record.user.username, record.user.name, req, tx);
    });
    if (!pair) throw new UnauthorizedException('登录已过期，请重新登录');
    return pair;
  }

  /** 已作废 token 再次出现：宽限期内视为并发刷新，否则判定为重放并吊销全部登录态 */
  private handleRevokedReuse(
    record: { userId: number; revokedAt: Date | null; user: { username: string } },
    req: Request,
  ): void {
    const sinceRevoked = Date.now() - (record.revokedAt?.getTime() ?? 0);
    if (sinceRevoked <= REFRESH_REUSE_GRACE_MS) return;
    void this.revokeAllRefreshTokens(record.userId);
    this.logger.audit(
      { event: 'token_replay', userId: record.userId, username: record.user.username, ip: req.ip, ua: this.ua(req) },
      `已作废的 refreshToken 被重复使用，疑似泄露，已吊销用户 ${record.user.username} 全部登录态`,
      'warn',
    );
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
      permissions: isSuperAdmin(user) ? ['*'] : user.permissions,
      // 前端据此决定是否拦截到强制改密页（刷新页面后依然有效）
      mustChangePassword: detail.mustChangePassword,
      passwordExpired: isPasswordExpired(detail.pwdUpdatedAt),
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
    const menus = await this.prisma.menu.findMany({
      where: { status: 'ENABLED', visible: true, type: { in: ['DIRECTORY', 'MENU'] } },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    let visible = menus;
    if (!isSuperAdmin(user)) {
      // 只算启用中的角色（与 JwtStrategy 计算权限的口径一致，否则禁用角色的菜单仍显示、点进去 403）
      const granted = await this.prisma.roleMenu.findMany({
        where: { role: { status: 'ENABLED', users: { some: { userId: user.id } } } },
        select: { menuId: true },
      });
      const allowed = new Set(granted.map((m) => m.menuId));
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
    await assertPasswordUsable(newPassword, detail.username, detail.password);
    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hash,
          mustChangePassword: false, // 已自行改密，解除强制改密
          pwdUpdatedAt: new Date(), // 早于此时间签发的 accessToken 立即失效（见 JwtStrategy）
        },
      }),
      // 全端踢下线：吊销所有 refreshToken
      this.revokeAllRefreshTokens(user.id),
    ]);
    this.permCache.invalidateUser(user.id);
    return { success: true };
  }

  // ---------- 内部 ----------
  private async issueTokens(
    userId: number,
    username: string,
    name: string,
    req: Request,
    db: Pick<PrismaService, 'refreshToken'> = this.prisma,
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: userId, username, name });
    const refreshToken = randomBytes(48).toString('hex');
    const ttl = parseDuration(this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d');
    await db.refreshToken.create({
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

  /** 吊销该用户全部未作废的 refreshToken（全端下线） */
  private revokeAllRefreshTokens(userId: number) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private buildTree(menus: Menu[]) {
    // 递归剔除没有可访问子节点的空目录（先修剪 children，再判断保留）
    return buildTree(menus, (n) => n.type === 'MENU' || n.children.length > 0);
  }
}

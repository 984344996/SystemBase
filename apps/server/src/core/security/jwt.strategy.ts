import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionCacheService } from './permission-cache.service';

export interface JwtPayload {
  sub: number;
  username: string;
  name: string;
  /** 签发时间（秒，jsonwebtoken 自动写入） */
  iat?: number;
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  roles: string[];       // 角色编码
  permissions: string[]; // 权限码集合
  /** 管理员重置过密码、尚未自行修改：服务端只放行改密/登出等少数接口（见 PasswordChangeGuard） */
  mustChangePassword: boolean;
  /** 最近一次改密时间（毫秒）：早于此时间签发的 accessToken 一律失效 */
  pwdUpdatedAt: number;
}

/**
 * JWT 策略：签名校验通过后加载用户角色/权限。
 * 结果按 PERMISSION_CACHE_TTL 缓存；用户/角色/菜单变更时主动失效（见 PermissionCacheService）。
 *
 * 改密/重置密码后旧 accessToken 立即失效：比较 token 的 iat 与用户 pwdUpdatedAt，
 * 早于改密时间签发的 token 一律拒绝（无需维护 token 黑名单）。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    let authUser = this.cache.get(payload.sub);
    if (!authUser) {
      const ticket = this.cache.ticket(payload.sub);
      authUser = await this.load(payload.sub);
      this.cache.set(authUser, ticket);
    }
    // iat 精度为秒：允许 1s 误差（改密请求本身签发的新 token 与 pwdUpdatedAt 可能在同一秒）
    if (payload.iat !== undefined && payload.iat * 1000 < authUser.pwdUpdatedAt - 1000) {
      throw new UnauthorizedException('密码已修改，请重新登录');
    }
    return authUser;
  }

  private async load(userId: number): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        roles: {
          where: { role: { status: 'ENABLED' } },
          include: {
            role: {
              include: {
                menus: {
                  where: { menu: { status: 'ENABLED' } },
                  include: { menu: { select: { permission: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!user || user.status !== 'ENABLED') {
      throw new UnauthorizedException('账号不存在或已被禁用');
    }
    const roles = user.roles.map((r) => r.role.code);
    const permissions = [
      ...new Set(
        user.roles.flatMap((r) => r.role.menus.map((m) => m.menu.permission).filter(Boolean) as string[]),
      ),
    ];
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      roles,
      permissions,
      mustChangePassword: user.mustChangePassword,
      pwdUpdatedAt: user.pwdUpdatedAt?.getTime() ?? 0,
    };
  }
}

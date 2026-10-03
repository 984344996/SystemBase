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
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  roles: string[];       // 角色编码
  permissions: string[]; // 权限码集合
}

/**
 * JWT 策略：签名校验通过后加载用户角色/权限。
 * 结果按 PERMISSION_CACHE_TTL 缓存；用户/角色/菜单变更时主动失效（见 PermissionCacheService）。
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
    const cached = this.cache.get(payload.sub);
    if (cached) return cached;
    const ticket = this.cache.ticket(payload.sub);
    const authUser = await this.load(payload.sub);
    this.cache.set(authUser, ticket);
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
    return { id: user.id, username: user.username, name: user.name, roles, permissions };
  }
}

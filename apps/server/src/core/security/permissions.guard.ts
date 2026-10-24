import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpStatus } from '@nestjs/common';
import { BizCode, BusinessException } from '../filter/business.exception';
import { AuthUser } from './jwt.strategy';
import { ALLOW_PENDING_PASSWORD_KEY, LOGIN_ONLY_KEY, PERMISSIONS_KEY } from './permissions.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/** 超级管理员角色编码（全仓库唯一定义处，其他地方引用此常量） */
export const SUPER_ROLE = 'SUPER_ADMIN';

export const isSuperAdmin = (user: Pick<AuthUser, 'roles'>) => user.roles.includes(SUPER_ROLE);

/**
 * 全局权限守卫（在 JWT 守卫之后执行），默认拒绝：
 *   @Public()                → 放行（JWT 守卫已跳过认证）
 *   必须改密且接口未标 @AllowPendingPassword → 403（业务码 40301，前端跳改密页）
 *   @RequirePermissions(...) → 超管放行，否则需拥有任一权限码
 *   @LoginOnly()             → 登录即可
 *   什么都没标               → 403（防止新接口忘加装饰器）
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
    if (meta<boolean>(IS_PUBLIC_KEY)) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) return false;

    if (user.mustChangePassword && !meta<boolean>(ALLOW_PENDING_PASSWORD_KEY)) {
      throw new BusinessException(BizCode.PASSWORD_CHANGE_REQUIRED, '请先修改密码', HttpStatus.FORBIDDEN);
    }

    const required = meta<string[]>(PERMISSIONS_KEY);
    if (required?.length) {
      if (isSuperAdmin(user)) return true;
      if (required.some((p) => user.permissions.includes(p))) return true;
      throw new ForbiddenException(`缺少权限：${required.join(' 或 ')}`);
    }

    if (meta<boolean>(LOGIN_ONLY_KEY)) return true;
    throw new ForbiddenException('接口未声明访问权限（缺少 @RequirePermissions / @LoginOnly）');
  }
}

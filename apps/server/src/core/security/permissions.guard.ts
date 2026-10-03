import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from './jwt.strategy';
import { PERMISSIONS_KEY } from './permissions.decorator';

export const SUPER_ROLE = 'SUPER_ADMIN';

/** 全局权限守卫：在 JWT 守卫之后执行，按 @RequirePermissions 校验权限码 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) return false;
    if (user.roles.includes(SUPER_ROLE)) return true;
    const ok = required.some((p) => user.permissions.includes(p));
    if (!ok) {
      throw new ForbiddenException(`缺少权限：${required.join(' 或 ')}`);
    }
    return true;
  }
}

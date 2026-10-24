import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { ALLOW_PENDING_PASSWORD_KEY, LOGIN_ONLY_KEY, PERMISSIONS_KEY } from './permissions.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthUser } from './jwt.strategy';

const baseUser: AuthUser = {
  id: 2,
  username: 'ops',
  name: '运营',
  roles: ['OPS'],
  permissions: ['system:user:list'],
  mustChangePassword: false,
  pwdUpdatedAt: 0,
};

function run(meta: Record<string, unknown>, user: AuthUser | undefined = baseUser) {
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
  const ctx = {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return () => new PermissionsGuard(reflector).canActivate(ctx);
}

describe('PermissionsGuard（默认拒绝）', () => {
  it('@Public 放行', () => {
    expect(run({ [IS_PUBLIC_KEY]: true }, undefined)()).toBe(true);
  });

  it('什么都没声明 → 403（防新接口忘加装饰器）', () => {
    expect(run({})).toThrow(ForbiddenException);
  });

  it('@LoginOnly 登录即放行', () => {
    expect(run({ [LOGIN_ONLY_KEY]: true })()).toBe(true);
  });

  it('@RequirePermissions：有权限码放行，没有则 403', () => {
    expect(run({ [PERMISSIONS_KEY]: ['system:user:list'] })()).toBe(true);
    expect(run({ [PERMISSIONS_KEY]: ['system:user:delete'] })).toThrow(ForbiddenException);
  });

  it('超管对 @RequirePermissions 接口放行', () => {
    expect(run({ [PERMISSIONS_KEY]: ['anything'] }, { ...baseUser, roles: ['SUPER_ADMIN'] })()).toBe(true);
  });

  it('必须先改密：只放行 @AllowPendingPassword 接口，其余 403 + 业务码 40301', () => {
    const pending = { ...baseUser, mustChangePassword: true };
    expect(run({ [LOGIN_ONLY_KEY]: true, [ALLOW_PENDING_PASSWORD_KEY]: true }, pending)()).toBe(true);
    try {
      run({ [PERMISSIONS_KEY]: ['system:user:list'] }, pending)();
      throw new Error('should throw');
    } catch (e: any) {
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse().bizCode).toBe(40301);
    }
  });
});

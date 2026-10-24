import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const LOGIN_ONLY_KEY = 'loginOnly';
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPassword';

/**
 * 接口级权限：@RequirePermissions('system:user:create')
 * 超级角色 SUPER_ADMIN 直接放行；其他用户按权限码匹配（拥有任意一个即通过）。
 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * 登录即可访问（不需要权限码），如个人资料、我的公告、下拉选项。
 *
 * 权限守卫是「默认拒绝」：既没有 @RequirePermissions、也没有 @LoginOnly / @Public 的接口一律 403，
 * 防止新接口忘加权限装饰器变成越权口子。需要「登录即可」时必须显式声明。
 */
export const LoginOnly = () => SetMetadata(LOGIN_ONLY_KEY, true);

/**
 * 「必须先改密」状态下仍可访问的接口（个人信息、改密、菜单）。
 * 管理员重置密码后，用户在改密前只能调这些接口——强制改密在服务端生效，绕过前端也没用。
 */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 接口级权限：@RequirePermissions('user:create')
 * 超级角色 SUPER_ADMIN 直接放行；其他用户按权限码匹配（拥有任意一个即通过）。
 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

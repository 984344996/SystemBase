import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记公开接口（跳过 JWT 认证），如登录、健康检查 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from './jwt.strategy';

/** 取当前登录用户：@CurrentUser() user */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

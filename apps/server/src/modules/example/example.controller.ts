import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../core/security/current-user.decorator';
import { AuthUser } from '../../core/security/jwt.strategy';

/**
 * 示例业务控制器：演示框架接入方式（登录即可访问，无需权限码）。
 * 开新项目时删除 example 模块，按 modules/<name>/ 的结构建业务模块即可。
 */
@Controller('example')
export class ExampleController {
  @Get('ping')
  ping(@CurrentUser() user: AuthUser) {
    return { pong: true, user: user.name, time: new Date().toISOString() };
  }
}

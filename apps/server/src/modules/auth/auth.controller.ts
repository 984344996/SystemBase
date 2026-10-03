import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../core/security/public.decorator';
import { CurrentUser } from '../../core/security/current-user.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { AuthUser } from '../../core/security/jwt.strategy';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * 登录：单独收紧限流（默认 5 次/分钟/IP，可配 THROTTLE_LOGIN_LIMIT）。
   * 注：装饰器在 DI 容器就绪前求值，无法注入 ConfigService，故直读 process.env；
   * 默认值须与 core/config/env.validation.ts 中的 THROTTLE_LOGIN_LIMIT 保持一致。
   */
  @Public()
  @Throttle({ default: { limit: Number(process.env.THROTTLE_LOGIN_LIMIT || 5), ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req);
  }

  /** 刷新 accessToken（refreshToken 轮换） */
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req);
  }

  /** 登出：吊销 refreshToken */
  @Public()
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  /** 个人信息（含角色与权限码） */
  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user);
  }

  /** 当前用户可见菜单树（前端动态路由数据源） */
  @Get('menus')
  menus(@CurrentUser() user: AuthUser) {
    return this.auth.myMenus(user);
  }

  /** 修改自己的基本资料 */
  @Put('profile')
  @OperateLog({ module: '个人中心', action: '修改资料' })
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }

  /** 修改自己的密码（改完全端下线） */
  @Put('password')
  @OperateLog({ module: '个人中心', action: '修改密码' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto.oldPassword, dto.newPassword);
  }
}

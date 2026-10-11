import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../security/public.decorator';
import { AuthUser } from '../security/jwt.strategy';
import { CurrentUser } from '../security/current-user.decorator';
import { ClientLogService, levelOf, sanitizeUrl } from './client-log.service';
import { ClientLogDto } from './client-log.dto';

/**
 * 前端日志上报：POST /api/logs/client
 *
 * - 公开接口（登录页、未登录时的错误也要能报），但限流收紧（默认 30 条/分钟/IP）
 * - 只落文件 web.YYYY-MM-DD.log，与后端日志分离
 * - 上报失败不影响业务：前端静默处理
 */
@ApiTags('前端日志')
@Controller('logs')
export class ClientLogController {
  constructor(private readonly clientLog: ClientLogService) {}

  @Public()
  @Post('client')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '上报前端错误（写入 web.YYYY-MM-DD.log）' })
  report(@Body() dto: ClientLogDto, @CurrentUser() user?: AuthUser) {
    if (!this.clientLog.isEnabled) return;
    const level = levelOf(dto.level);
    // 只上报 error/warn：info 级别量大且价值低（前端可通过开关关闭）
    this.clientLog.write(level, dto.msg || '前端异常', {
      url: sanitizeUrl(dto.url),
      ua: dto.ua,
      stack: dto.stack,
      traceId: dto.traceId,
      userId: user?.id,
      release: dto.release,
      ...(dto.kind ? { kind: dto.kind } : {}),
    });
  }
}

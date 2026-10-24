import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../security/public.decorator';
import { ClientLogService, levelOf, sanitizeUrl } from './client-log.service';
import { ClientLogDto } from './client-log.dto';

/**
 * 前端日志上报：POST /api/logs/client
 *
 * - 公开接口（登录页、未登录时的错误也要能报），但限流收紧（默认 30 条/分钟/IP），
 *   服务端另有单日字节预算与去重（见 ClientLogService.admit）
 * - 只落文件 web.YYYY-MM-DD.log，与后端日志分离
 * - 上报失败不影响业务：前端静默处理
 */
@ApiTags('前端日志')
@Controller('logs')
export class ClientLogController {
  constructor(
    private readonly clientLog: ClientLogService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('client')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: '上报前端错误（写入 web.YYYY-MM-DD.log）' })
  report(@Body() dto: ClientLogDto, @Req() req: Request) {
    if (!this.clientLog.isEnabled) return;
    const level = levelOf(dto.level);
    this.clientLog.write(level, dto.msg || '前端异常', {
      url: sanitizeUrl(dto.url),
      ua: dto.ua,
      stack: dto.stack,
      traceId: dto.traceId,
      userId: this.optionalUserId(req),
      release: dto.release,
      ...(dto.kind ? { kind: dto.kind } : {}),
    });
  }

  /**
   * 可选身份：@Public 接口不经过 JWT 守卫，@CurrentUser 永远为空。
   * 这里有 token 就验签取 sub（只用于日志归属，验签失败/过期就当匿名）。
   */
  private optionalUserId(req: Request): number | undefined {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return undefined;
    try {
      return this.jwt.verify<{ sub: number }>(auth.slice(7)).sub;
    } catch {
      return undefined;
    }
  }
}

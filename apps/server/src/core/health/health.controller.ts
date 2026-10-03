import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../security/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** 探活接口（公开）：依赖正常 200 / 依赖故障 503，供 docker healthcheck 与网关探活判断 */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    let healthy = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
      healthy = false;
    }
    // 探活必须以 HTTP 状态码表达结果：healthcheck(curl -sf)只看状态码，恒 200 会让故障被掩盖
    if (!healthy) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }
}

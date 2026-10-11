import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { accessSync, constants, existsSync } from 'node:fs';
import { Public } from '../security/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../logger/logger.service';

/**
 * 健康检查（全部公开）：
 *   GET /api/health        综合健康（数据库）：脚本与外部探活用，依赖故障返回 503
 *   GET /api/health/live   存活：进程级，恒 200（不查依赖，用于重启策略判断）
 *   GET /api/health/ready  就绪：数据库 + Redis（仅 LOCK_DRIVER=redis 时）+ 日志目录可写，不可服务时 503
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /** 综合健康（保持原有语义：脚本与外部探活依赖它判断数据库是否可用） */
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
    // 探活必须以 HTTP 状态码表达结果：探活方(curl -sf 等)只看状态码，恒 200 会让故障被掩盖
    if (!healthy) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }

  /** 存活探针：只要进程还在响应就是 200（用于判断是否该重启，而非是否该接流量） */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSec: Math.floor(process.uptime()) };
  }

  /** 就绪探针：依赖齐备才应接入流量 */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, string> = {};
    let ready = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'up';
    } catch {
      checks.database = 'down';
      ready = false;
    }

    // Redis 只在真正使用（LOCK_DRIVER=redis）时才作为依赖，否则不因未装 Redis 而判定未就绪
    if (this.config.get<string>('LOCK_DRIVER') === 'redis') {
      checks.redis = await this.pingRedis();
      if (checks.redis !== 'up') ready = false;
    }

    checks.logDir = this.logDirWritable() ? 'writable' : 'readonly';
    if (checks.logDir === 'readonly') {
      ready = false;
      this.logger.warn({}, '日志目录不可写，就绪检查失败');
    }

    if (!ready) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ready' : 'not-ready', checks, timestamp: new Date().toISOString() };
  }

  /** 轻量 Redis 探测：不引入额外依赖，仅在就绪检查时按需连接 */
  private async pingRedis(): Promise<'up' | 'down'> {
    const url = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    let Redis: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Redis = require('ioredis');
    } catch {
      return 'down';
    }
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null as any });
    try {
      const pong = await client.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      await client.quit().catch(() => undefined);
    }
  }

  private logDirWritable(): boolean {
    const dir = this.config.get<string>('LOG_DIR') || 'logs';
    if (!existsSync(dir)) return true; // 启动时会自行创建，缺失不算未就绪
    try {
      accessSync(dir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

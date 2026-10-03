import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AppLogger } from './logger.service';
import { runWithTraceId } from './trace.context';

/** 探活等高频无业务意义的路径不记访问日志（docker healthcheck 每 15s 一次，一天 5760 行噪音） */
const SKIP_ACCESS_LOG = ['/api/health'];

/**
 * 请求链路中间件：
 * 1. 生成/透传 traceId（响应头 X-Trace-Id 返回给调用方，便于报障定位）
 * 2. 记录 HTTP 访问日志（category=access；5xx→ERROR，4xx→WARN，其余 INFO）
 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-trace-id'];
    const traceId =
      (typeof incoming === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) && incoming) || this.logger.newTraceId();
    res.setHeader('X-Trace-Id', traceId);

    const startAt = Date.now();
    runWithTraceId(traceId, () => {
      res.on('finish', () => {
        if (SKIP_ACCESS_LOG.some((p) => req.originalUrl.startsWith(p))) return;
        const status = res.statusCode;
        const costMs = Date.now() - startAt;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        this.logger.access(
          {
            traceId,
            method: req.method,
            url: req.originalUrl,
            status,
            costMs,
            ip: req.ip,
            userId: (req as { user?: { id?: number } }).user?.id,
            ua: (req.headers['user-agent'] || '').slice(0, 200),
          },
          `${req.method} ${req.originalUrl} ${status} ${costMs}ms`,
          level,
        );
      });
      next();
    });
  }
}

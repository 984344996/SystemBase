import { Injectable, NestMiddleware } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * HTTP 指标采集：在响应结束时记录「方法 + 路由模板 + 状态码 + 耗时」。
 * 用 Express 的 route.path（如 /users/:id）而非真实 URL，避免用户 id 之类的高基数标签。
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: any, res: any, next: () => void): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route?.path || req.baseUrl || req.path || 'unknown';
      const costMs = Number(process.hrtime.bigint() - start) / 1e6;
      this.metrics.observeHttp(req.method, route, res.statusCode, costMs);
    });
    next();
  }
}

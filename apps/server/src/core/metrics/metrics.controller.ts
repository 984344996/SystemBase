import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../security/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus 抓取端点：/api/metrics（METRICS_ENABLED=on 才启用）。
 * 默认关闭：指标会暴露路由与流量信息，需自行保证不被公网访问（建议仅内网或加 nginx 鉴权）。
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  // 直接响应纯文本：指标不能被统一响应结构包裹（Prometheus 只认文本格式）
  index(@Res() res: Response) {
    // 与 env 校验允许的取值一致：on / true / 1 都表示开启（原来只认 on，配 true 能通过校验却不生效）
    if (!['on', 'true', '1'].includes(String(process.env.METRICS_ENABLED || 'off').trim().toLowerCase())) {
      throw new NotFoundException();
    }
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(this.metrics.render());
  }
}

import { Injectable } from '@nestjs/common';

interface HttpBucket {
  count: number;
  sumMs: number;
  maxMs: number;
}

/**
 * 进程内指标（零依赖）：供 /api/metrics 输出 Prometheus 文本格式。
 *
 * 取舍：不引 prom-client，避免为「看一眼指标」新增依赖；多实例时各实例独立暴露，
 * 由 Prometheus 按 instance 标签聚合（rate/avg 在查询侧计算，故只暴露计数与耗时总和）。
 */
@Injectable()
export class MetricsService {
  private readonly http = new Map<string, HttpBucket>();
  private readonly jobs = new Map<string, number>();
  private readonly startedAt = Date.now();

  observeHttp(method: string, route: string, status: number, costMs: number): void {
    const key = `${method} ${route} ${status}`;
    const b = this.http.get(key) ?? { count: 0, sumMs: 0, maxMs: 0 };
    b.count += 1;
    b.sumMs += costMs;
    if (costMs > b.maxMs) b.maxMs = costMs;
    this.http.set(key, b);
  }

  /** 任务执行计数：key 形如 `handlerKey success` / `handlerKey fail` */
  incJob(handlerKey: string, ok: boolean): void {
    const key = `${handlerKey} ${ok ? 'success' : 'fail'}`;
    this.jobs.set(key, (this.jobs.get(key) ?? 0) + 1);
  }

  render(): string {
    const lines: string[] = [];
    const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    lines.push('# HELP sb_uptime_seconds 进程已运行秒数');
    lines.push('# TYPE sb_uptime_seconds gauge');
    lines.push(`sb_uptime_seconds ${uptimeSec}`);

    lines.push('# HELP sb_memory_bytes 进程内存占用（rss/heapUsed/heapTotal）');
    lines.push('# TYPE sb_memory_bytes gauge');
    lines.push(`sb_memory_bytes{type="rss"} ${mem.rss}`);
    lines.push(`sb_memory_bytes{type="heapUsed"} ${mem.heapUsed}`);
    lines.push(`sb_memory_bytes{type="heapTotal"} ${mem.heapTotal}`);

    lines.push('# HELP sb_cpu_microseconds 进程 CPU 累计耗时（user/system）');
    lines.push('# TYPE sb_cpu_microseconds counter');
    lines.push(`sb_cpu_microseconds{type="user"} ${cpu.user}`);
    lines.push(`sb_cpu_microseconds{type="system"} ${cpu.system}`);

    lines.push('# HELP sb_http_requests_total HTTP 请求数（按方法/路由/状态码）');
    lines.push('# TYPE sb_http_requests_total counter');
    for (const [key, b] of [...this.http.entries()].sort()) {
      const [method, route, status] = splitKey(key);
      lines.push(`sb_http_requests_total{method="${method}",route="${route}",status="${status}"} ${b.count}`);
    }

    lines.push('# HELP sb_http_request_duration_ms HTTP 请求耗时（毫秒，累计值与最大值）');
    lines.push('# TYPE sb_http_request_duration_ms summary');
    for (const [key, b] of [...this.http.entries()].sort()) {
      const [method, route, status] = splitKey(key);
      lines.push(
        `sb_http_request_duration_ms_sum{method="${method}",route="${route}",status="${status}"} ${round(b.sumMs)}`,
      );
      lines.push(
        `sb_http_request_duration_ms_max{method="${method}",route="${route}",status="${status}"} ${round(b.maxMs)}`,
      );
    }

    lines.push('# HELP sb_job_runs_total 定时任务执行次数（按处理器与结果）');
    lines.push('# TYPE sb_job_runs_total counter');
    for (const [key, count] of [...this.jobs.entries()].sort()) {
      const [handler, result] = key.split(' ');
      lines.push(`sb_job_runs_total{handler="${handler}",result="${result}"} ${count}`);
    }

    lines.push('# HELP sb_build_info 构建信息');
    lines.push('# TYPE sb_build_info gauge');
    lines.push(`sb_build_info{version="${process.env.npm_package_version || '0.2.0'}",node="${process.version}"} 1`);

    return `${lines.join('\n')}\n`;
  }
}

/** "GET /users/:id 200" → [method, route, status]（route 最后一段为状态码） */
function splitKey(key: string): [string, string, string] {
  const idx = key.lastIndexOf(' ');
  const head = key.slice(0, idx);
  const status = key.slice(idx + 1);
  const sep = head.indexOf(' ');
  return [head.slice(0, sep), head.slice(sep + 1), status];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('HTTP 指标按 方法/路由/状态码 聚合（累计与最大值）', () => {
    const m = new MetricsService();
    m.observeHttp('GET', '/users/:id', 200, 10);
    m.observeHttp('GET', '/users/:id', 200, 30);
    m.observeHttp('GET', '/users/:id', 500, 5);
    const text = m.render();

    expect(text).toContain('sb_http_requests_total{method="GET",route="/users/:id",status="200"} 2');
    expect(text).toContain('sb_http_requests_total{method="GET",route="/users/:id",status="500"} 1');
    expect(text).toContain('sb_http_request_duration_ms_sum{method="GET",route="/users/:id",status="200"} 40');
    expect(text).toContain('sb_http_request_duration_ms_max{method="GET",route="/users/:id",status="200"} 30');
  });

  it('任务执行指标按处理器与结果区分', () => {
    const m = new MetricsService();
    m.incJob('system.cleanup', true);
    m.incJob('system.cleanup', true);
    m.incJob('system.cleanup', false);
    const text = m.render();
    expect(text).toContain('sb_job_runs_total{handler="system.cleanup",result="success"} 2');
    expect(text).toContain('sb_job_runs_total{handler="system.cleanup",result="fail"} 1');
  });

  it('输出包含进程指标与 Prometheus 必备的 TYPE 声明', () => {
    const m = new MetricsService();
    const text = m.render();
    expect(text).toContain('# TYPE sb_uptime_seconds gauge');
    expect(text).toMatch(/sb_uptime_seconds \d+/);
    expect(text).toContain('sb_memory_bytes{type="rss"}');
    expect(text).toContain('sb_cpu_microseconds{type="user"}');
    expect(text).toContain('sb_build_info');
  });

  it('路由含空格等字符不影响解析（状态码取最后一段）', () => {
    const m = new MetricsService();
    m.observeHttp('POST', '/a b', 201, 1);
    expect(m.render()).toContain('sb_http_requests_total{method="POST",route="/a b",status="201"} 1');
  });
});

import { ErrorRequestHandler } from 'express';
import { AppLogger } from '../logger/logger.service';

/**
 * 请求体解析错误处理（Express 层）：
 * bodyParser 在 Nest 管道之前执行，其错误不会进入全局异常过滤器，
 * 默认会返回 Express 的 HTML 错误页且不记日志。这里统一为 {code,data,message,traceId} 并写 WARN 日志。
 */
export function bodyParserErrorHandler(logger: AppLogger, limit: string): ErrorRequestHandler {
  return (err, req, res, next) => {
    const status = Number(err?.status || err?.statusCode);
    if (!(status >= 400 && status < 500)) return next(err);

    const message =
      err.type === 'entity.too.large'
        ? `请求体过大（上限 ${limit}）`
        : err.type === 'entity.parse.failed'
          ? '请求体不是合法的 JSON'
          : err.message || '请求体解析失败';
    const incoming = req.headers['x-trace-id'];
    const traceId = (typeof incoming === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) && incoming) || logger.newTraceId();

    logger.access(
      { traceId, method: req.method, url: req.originalUrl, status, ip: req.ip, reason: err.type, length: req.headers['content-length'] },
      `${req.method} ${req.originalUrl} ${status} ${message}`,
      'warn',
    );
    res.setHeader('X-Trace-Id', traceId);
    res.status(status).json({ code: status, data: null, message, traceId });
  };
}

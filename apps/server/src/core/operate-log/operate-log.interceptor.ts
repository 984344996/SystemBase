import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from '../logger/logger.service';
import { AuthUser } from '../security/jwt.strategy';
import { OPERATE_LOG_KEY, OperateLogOptions } from './operate-log.decorator';

/**
 * 敏感键名（不区分大小写、子串匹配）：password / confirmPassword / pwd / secret / token / captcha / apiKey ...
 * 精确匹配会漏掉 confirmPassword、captchaCode、webhookSecret 等变体。
 */
const SENSITIVE_KEY = /pass(word)?|pwd|secret|token|captcha|api[-_]?key|credential|authorization|cookie/i;
const MAX_DEPTH = 3;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  // 超过深度直接截断（原样返回会让深层的 password 绕过脱敏，且整个大对象写进日志）
  if (depth > MAX_DEPTH) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return typeof value === 'string' ? value.slice(0, 500) : value;
}

/**
 * 操作审计：@OperateLog 装饰的接口，成功记 INFO、失败记 WARN，
 * 写入日志文件 category=audit / event=operate（不落库）。
 */
@Injectable()
export class OperateLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: AppLogger,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const options = this.reflector.getAllAndOverride<OperateLogOptions>(OPERATE_LOG_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!options) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const startAt = Date.now();

    const record = (error?: unknown) => {
      const user = (req as any).user as AuthUser | undefined;
      const body = { ...(req.body || {}) };
      for (const k of options.omitParams ?? []) if (k in body) body[k] = '[OMITTED]';
      if ((req as any).file || (req as any).files) body.__files = true;
      const fields = {
        event: 'operate',
        success: !error,
        userId: user?.id,
        username: user?.username,
        module: options.module,
        action: options.action,
        method: req.method,
        path: req.originalUrl.slice(0, 250),
        params: redact({ ...(Object.keys(req.params || {}).length ? { _path: req.params } : {}), ...body }),
        ip: req.ip,
        costMs: Date.now() - startAt,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      };
      const msg = `${options.module}/${options.action}${error ? ' 失败' : ''}`;
      this.logger.audit(fields, msg, error ? 'warn' : 'info');
    };

    return next.handle().pipe(tap({ next: () => record(), error: (e) => record(e) }));
  }
}

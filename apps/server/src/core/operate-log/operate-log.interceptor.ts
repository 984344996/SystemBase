import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from '../logger/logger.service';
import { AuthUser } from '../security/jwt.strategy';
import { OPERATE_LOG_KEY, OperateLogOptions } from './operate-log.decorator';

const SENSITIVE_KEYS = ['password', 'oldPassword', 'newPassword', 'token', 'refreshToken', 'accessToken'];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.includes(k) ? '[REDACTED]' : redact(v, depth + 1);
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

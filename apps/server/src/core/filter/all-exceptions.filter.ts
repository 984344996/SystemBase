import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AppLogger } from '../logger/logger.service';
import { getTraceId } from '../logger/trace.context';
import { BusinessException } from './business.exception';

/** 统一错误响应结构（与成功结构同形，code 非 0） */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly appLogger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const traceId = getTraceId() || '';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = 500;
    let data: unknown = null;
    let detail: unknown;

    if (exception instanceof BusinessException) {
      // 业务异常：code 用业务码（与 HTTP 状态解耦），data 透传附加信息
      status = exception.getStatus();
      const body = exception.getResponse() as { bizCode: number; message: string; data?: unknown };
      message = body.message;
      code = body.bizCode;
      data = body.data ?? null;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status;
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const m = (body as any).message;
        message = Array.isArray(m) ? m.join('；') : String(m || exception.message);
        detail = (body as any).error;
      }
    } else if (exception instanceof Error) {
      message = process.env.NODE_ENV === 'production' ? '服务器内部错误' : exception.message;
      detail = exception.stack;
    }

    // 5xx 记 error，4xx 记 warn，均带 traceId 可在日志文件检索
    const logFields = { traceId, status, code, path: host.switchToHttp().getRequest().url, detail };
    if (status >= 500) {
      this.appLogger.errorFields(logFields, message);
    } else {
      this.appLogger.warnFields(logFields, message);
    }

    res.status(status).json({ code, data, message, traceId });
  }
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { AppLogger } from '../logger/logger.service';
import { getTraceId } from '../logger/trace.context';
import { BizCode, BusinessException } from './business.exception';

/** 归一化后的错误：HTTP 状态 + 响应 code（业务码或 HTTP 状态）+ 提示 + 附加数据 */
interface Normalized {
  status: number;
  code: number;
  message: string;
  data: unknown;
  /** 只写日志，不返回给前端 */
  detail?: unknown;
}

/**
 * Prisma 已知错误 → 业务错误。
 * 没有在业务代码里显式处理的数据库约束错误（并发写入、遗漏的校验等）在这里集中兜底，
 * 避免一律变成 500「服务器内部错误」——前端能拿到明确的提示和业务码。
 *   P2002 唯一约束冲突           → 409 / 40901 数据已存在
 *   P2025 要更新/删除的记录不存在 → 404 / 40401 记录不存在或已删除
 *   P2003 外键约束失败           → 409 / 40902 被其他数据引用（删除时）或关联数据不存在（写入时）
 *   P2000 字段值超过列长度       → 400 / 40001 字段过长
 * 其余 Prisma 错误保持 500（属于代码或数据库问题，需要看日志排查）
 */
/** 唯一约束字段 → 提示用的中文名（不在表里的只提示「数据已存在」，不把字段 / 索引名返回给前端） */
const FIELD_LABELS: Record<string, string> = {
  username: '用户名',
  code: '编码',
  key: '参数键',
  value: '值',
  name: '名称',
  phone: '手机号',
  email: '邮箱',
  permission: '权限码',
  handlerKey: '处理器',
};

/**
 * P2002 的 meta.target 转成提示文案：MySQL 下通常是索引名（如 User_username_key、DictItem_dictId_value_key），
 * 也可能是字段数组。全部字段都认识才拼出「用户名 重复」，否则只说「数据已存在」（索引名会暴露表结构）
 */
export function duplicateMessage(target: string | string[] | undefined): string {
  const fields = Array.isArray(target)
    ? target
    : (/^[A-Za-z0-9]+_(.+)_key$/.exec(target ?? '')?.[1] ?? '').split('_').filter(Boolean);
  const labels = fields.filter((f) => f !== 'dictId').map((f) => FIELD_LABELS[f]);
  if (!labels.length || labels.some((l) => !l)) return '数据已存在';
  return `数据已存在（${labels.join('、')}重复）`;
}

function fromPrisma(e: Prisma.PrismaClientKnownRequestError): Normalized | null {
  const meta = (e.meta ?? {}) as { target?: string | string[]; field_name?: string; column_name?: string };
  const target = Array.isArray(meta.target) ? meta.target.join(', ') : meta.target;
  switch (e.code) {
    case 'P2002':
      return { status: HttpStatus.CONFLICT, code: BizCode.DUPLICATE, message: duplicateMessage(meta.target), data: null, detail: `P2002 ${target ?? ""}` };
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, code: BizCode.NOT_FOUND, message: '记录不存在或已删除', data: null };
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        code: BizCode.INVALID_STATE,
        message: '操作失败：数据被其他记录引用，或关联的数据不存在',
        data: null,
        detail: meta.field_name,
      };
    case 'P2000':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: BizCode.INVALID_DATA,
        message: meta.column_name ? `字段 ${meta.column_name} 的值过长` : '提交的字段值过长',
        data: null,
      };
    default:
      return null;
  }
}

/** 统一错误响应结构（与成功结构同形，code 非 0）：{ code, data, message, traceId } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly appLogger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const traceId = getTraceId() || '';
    const n = this.normalize(exception);

    // 5xx 记 error（带堆栈），4xx 记 warn；均带 traceId，可在日志文件检索
    const logFields = { traceId, status: n.status, code: n.code, path: String(host.switchToHttp().getRequest().url ?? '').split('?')[0], detail: n.detail };
    if (n.status >= 500) this.appLogger.errorFields(logFields, n.message);
    else this.appLogger.warnFields(logFields, n.message);

    res.status(n.status).json({ code: n.code, data: n.data, message: n.message, traceId });
  }

  /** 各类异常 → 统一结构 */
  private normalize(exception: unknown): Normalized {
    // 业务异常：code 用业务码（与 HTTP 状态解耦），data 透传附加信息
    if (exception instanceof BusinessException) {
      const body = exception.getResponse() as { bizCode: number; message: string; data?: unknown };
      return { status: exception.getStatus(), code: body.bizCode, message: body.message, data: body.data ?? null };
    }
    // Nest 内置 HTTP 异常（含校验失败的 400）：code 等于 HTTP 状态
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') return { status, code: status, message: body, data: null };
      const b = (body ?? {}) as { message?: unknown; error?: unknown };
      const message = Array.isArray(b.message) ? b.message.join('；') : String(b.message || exception.message);
      return { status, code: status, message, data: null, detail: b.error };
    }
    // 数据库约束错误：集中映射为业务错误
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = fromPrisma(exception);
      if (mapped) return { ...mapped, detail: mapped.detail ?? `${exception.code}: ${exception.message}` };
    }
    // 其余未知错误：只有明确是开发/测试环境才返回原始错误信息（NODE_ENV 漏配也不暴露内部信息）
    const isDevLike = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const message = exception instanceof Error && isDevLike ? exception.message : '服务器内部错误';
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 500,
      message,
      data: null,
      detail: exception instanceof Error ? exception.stack : exception,
    };
  }
}

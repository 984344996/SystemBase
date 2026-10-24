import { HttpStatus } from '@nestjs/common';
import { BusinessException, BizCode } from '../filter/business.exception';

/** Prisma 唯一约束冲突（P2002）判定 */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * 唯一约束竞态兜底：预检通过但另一请求抢先写入时，把 P2002 转成业务错误码 40901
 * （HTTP 409 Conflict，前端可凭 code 精确识别「重复」类错误）。
 * 各模块 create 统一用它包裹 prisma.create，错误文案与预检保持一致。
 */
export async function withUniqueViolation<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) throw new BusinessException(BizCode.DUPLICATE, message, HttpStatus.CONFLICT);
    throw e;
  }
}

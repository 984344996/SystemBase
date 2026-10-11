import { BadRequestException } from '@nestjs/common';

/** Prisma 唯一约束冲突（P2002）判定 */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * 唯一约束竞态兜底：预检通过但另一请求抢先写入时，把 P2002 转成友好的 400 提示而非 500。
 * 各模块 create 统一用它包裹 prisma.create，错误文案与预检保持一致。
 */
export async function withUniqueViolation<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e)) throw new BadRequestException(message);
    throw e;
  }
}

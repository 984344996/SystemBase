import { PrismaService } from '../prisma/prisma.service';
import { PageResult } from './pagination.dto';

type SortOrder = { [key: string]: 'asc' | 'desc' };

/** 解析 "createdAt:desc,name:asc" 形式排序串 */
export function parseSort(sort?: string, fallback: SortOrder = { id: 'desc' }): SortOrder {
  if (!sort) return fallback;
  const order: SortOrder = {};
  for (const part of sort.split(',')) {
    const [field, dir] = part.trim().split(':');
    if (field && (dir === 'asc' || dir === 'desc')) {
      order[field.trim()] = dir;
    }
  }
  return Object.keys(order).length ? order : fallback;
}

/**
 * Prisma 分页辅助：
 * const { list, total } = await paginate(prisma, prisma.user, { where, page, pageSize, sort, orderBy })
 */
export async function paginate<T>(
  prisma: PrismaService,
  model: { findMany(args: any): Promise<any>; count(args: any): Promise<number> },
  args: {
    where?: any;
    page: number;
    pageSize: number;
    sort?: string;
    orderBy?: SortOrder;
    include?: any;
    select?: any;
  },
): Promise<PageResult<T>> {
  const { where, page, pageSize, sort, orderBy, include, select } = args;
  const order = orderBy || parseSort(sort);
  // $transaction 数组形式要求 PrismaPromise；这里 model 是结构化类型，断言后传入以获得一致性快照
  const [list, total] = await prisma.$transaction([
    model.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: order,
      ...(include ? { include } : {}),
      ...(select ? { select } : {}),
    }),
    model.count({ where }),
  ] as any);
  return { list: list as T[], total, page, pageSize };
}

import { PrismaService } from '../prisma/prisma.service';
import { PageResult } from './pagination.dto';

type SortOrder = { [key: string]: 'asc' | 'desc' };

/** 未指定 sortable 时允许的排序字段（所有业务表都有的通用列） */
export const DEFAULT_SORTABLE = ['id', 'createdAt', 'updatedAt'];

/** 单次请求最多几个排序字段 */
const MAX_SORT_FIELDS = 3;

/**
 * 解析 "createdAt:desc,name:asc" 形式排序串。
 * 只接受白名单内的字段：防止按任意列排序（如 password）或传入不存在的字段触发 Prisma 校验错误（500）。
 * 白名单外的字段直接忽略，全部无效时回退 fallback。
 */
export function parseSort(
  sort?: string,
  fallback: SortOrder = { id: 'desc' },
  sortable: string[] = DEFAULT_SORTABLE,
): SortOrder {
  if (!sort) return fallback;
  const order: SortOrder = {};
  for (const part of sort.split(',').slice(0, MAX_SORT_FIELDS)) {
    const [rawField, dir] = part.trim().split(':');
    const field = rawField?.trim();
    if (field && sortable.includes(field) && (dir === 'asc' || dir === 'desc')) {
      order[field] = dir;
    }
  }
  return Object.keys(order).length ? order : fallback;
}

/**
 * Prisma 分页辅助：
 * const { list, total } = await paginate(prisma, prisma.user, { where, page, pageSize, sort, sortable })
 *
 * sortable：允许前端排序的字段白名单（默认 id/createdAt/updatedAt）；
 * orderBy：服务端固定排序（优先于 sort，不受白名单限制）。
 */
export async function paginate<T>(
  prisma: PrismaService,
  model: { findMany(args: any): Promise<any>; count(args: any): Promise<number> },
  args: {
    where?: any;
    page: number;
    pageSize: number;
    sort?: string;
    sortable?: string[];
    orderBy?: SortOrder | SortOrder[];
    include?: any;
    select?: any;
  },
): Promise<PageResult<T>> {
  const { where, page, pageSize, sort, sortable, orderBy, include, select } = args;
  const order = orderBy || parseSort(sort, undefined, sortable);
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

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paginate } from '../../core/pagination/paginate';
import { CreateNoticeDto, QueryNoticeDto, UpdateNoticeDto } from './notice.dto';

/**
 * 通知公告：草稿/发布 + 置顶 + 有效期 + 已读记录。
 * 列表接口区分两类：
 *   - mine()：当前用户可见（已发布且在有效期内），含未读标记
 *   - list()：管理端分页（全部）
 */
@Injectable()
export class NoticeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 管理端列表 */
  list(query: QueryNoticeDto) {
    return paginate(this.prisma, this.prisma.notice, {
      where: {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.keyword ? { title: { contains: query.keyword } } : {}),
      },
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort || 'createdAt:desc',
      sortable: ['id', 'title', 'status', 'top', 'createdAt'],
    });
  }

  /** 当前用户可见的公告/消息（置顶优先），带已读标记 */
  async mine(userId: number, limit = 20) {
    const now = new Date();
    const rows = await this.prisma.notice.findMany({
      where: {
        status: 'PUBLISHED',
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gte: now } }] },
        ],
      },
      orderBy: [{ top: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    const reads = await this.prisma.noticeRead.findMany({
      where: { userId, noticeId: { in: rows.map((r) => r.id) } },
      select: { noticeId: true },
    });
    const readSet = new Set(reads.map((r) => r.noticeId));
    return rows.map((r) => ({ ...r, read: readSet.has(r.id) }));
  }

  /** 未读数量（顶栏红点） */
  async unreadCount(userId: number): Promise<number> {
    const all = await this.mine(userId, 100);
    return all.filter((n) => !n.read).length;
  }

  detail(id: number) {
    return this.prisma.notice.findUnique({ where: { id } });
  }

  async create(dto: CreateNoticeDto, publisherId?: number) {
    this.assertRange(dto.startAt, dto.endAt);
    return this.prisma.notice.create({
      data: {
        title: dto.title,
        content: dto.content,
        type: dto.type ?? 'NOTICE',
        top: dto.top ?? false,
        status: dto.status ?? 'DRAFT',
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        publisherId: publisherId ?? null,
      },
    });
  }

  async update(id: number, dto: UpdateNoticeDto) {
    const row = await this.prisma.notice.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('公告不存在');
    this.assertRange(dto.startAt, dto.endAt);
    // null = 清空有效期（长期有效）；undefined = 不修改
    const toDate = (v: string | null | undefined) => (v === null ? null : v ? new Date(v) : undefined);
    return this.prisma.notice.update({
      where: { id },
      data: {
        ...dto,
        startAt: toDate(dto.startAt),
        endAt: toDate(dto.endAt),
      },
    });
  }

  /** 发布：草稿 → 已发布 */
  async publish(id: number) {
    const row = await this.prisma.notice.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('公告不存在');
    return this.prisma.notice.update({ where: { id }, data: { status: 'PUBLISHED' } });
  }

  async remove(id: number) {
    const row = await this.prisma.notice.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('公告不存在');
    await this.prisma.notice.delete({ where: { id } }); // 已读记录级联删除
    return { success: true };
  }

  /** 标记已读（幂等） */
  async read(id: number, userId: number) {
    const row = await this.prisma.notice.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('公告不存在');
    await this.prisma.noticeRead.upsert({
      where: { noticeId_userId: { noticeId: id, userId } },
      update: {},
      create: { noticeId: id, userId },
    });
    return { success: true };
  }

  private assertRange(startAt?: string | null, endAt?: string | null): void {
    if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
      throw new BadRequestException('生效开始时间不能晚于结束时间');
    }
  }
}

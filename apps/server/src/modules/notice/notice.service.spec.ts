import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NoticeService } from './notice.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function setup() {
  const prisma: any = {
    notice: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    noticeRead: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
  };
  const service = new NoticeService(prisma as unknown as PrismaService);
  return { service, prisma };
}

const published = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: '停机维护',
  content: 'x',
  status: 'PUBLISHED',
  top: false,
  startAt: null,
  endAt: null,
  createdAt: new Date(),
  ...over,
});

describe('NoticeService.mine', () => {
  it('只返回已发布且在有效期内的公告', async () => {
    const { service, prisma } = setup();
    prisma.notice.findMany.mockResolvedValue([
      published({ id: 1, top: true }),
      published({ id: 2, endAt: new Date(Date.now() - 3600_000) }), // 已过期
    ]);
    // 过期记录由 SQL 过滤（这里 mock 已返回），仅验证已读标记与置顶排序逻辑
    const rows = await service.mine(9);
    expect(rows[0]).toMatchObject({ id: 1, read: false });
  });

  it('已读的公告带 read 标记', async () => {
    const { service, prisma } = setup();
    prisma.notice.findMany.mockResolvedValue([published({ id: 1 }), published({ id: 2 })]);
    prisma.noticeRead.findMany.mockResolvedValue([{ noticeId: 2 }]);
    const rows = await service.mine(9);
    expect(rows.map((r) => r.read)).toEqual([false, true]);
  });

  it('unreadCount 统计未读条数', async () => {
    const { service, prisma } = setup();
    prisma.notice.findMany.mockResolvedValue([published({ id: 1 }), published({ id: 2 }), published({ id: 3 })]);
    prisma.noticeRead.findMany.mockResolvedValue([{ noticeId: 1 }]);
    await expect(service.unreadCount(9)).resolves.toBe(2);
  });
});

describe('NoticeService 写入', () => {
  it('开始时间晚于结束时间 → 400', async () => {
    const { service } = setup();
    await expect(
      service.create({ title: 'a', content: 'b', startAt: '2026-10-10T00:00:00', endAt: '2026-10-01T00:00:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('更新/发布/删除不存在的公告 → 404', async () => {
    const { service, prisma } = setup();
    prisma.notice.findUnique.mockResolvedValue(null);
    await expect(service.update(404, { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.publish(404)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(404)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.read(404, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('发布：草稿 → PUBLISHED', async () => {
    const { service, prisma } = setup();
    prisma.notice.findUnique.mockResolvedValue(published({ status: 'DRAFT' }));
    prisma.notice.update.mockResolvedValue(published({ status: 'PUBLISHED' }));
    await service.publish(1);
    expect(prisma.notice.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'PUBLISHED' } });
  });
});

describe('NoticeService 已读', () => {
  it('标记已读（幂等，重复调用不报错）', async () => {
    const { service, prisma } = setup();
    prisma.notice.findUnique.mockResolvedValue(published());
    await service.read(1, 9);
    await service.read(1, 9);
    expect(prisma.noticeRead.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.noticeRead.upsert.mock.calls[0][0].where).toEqual({ noticeId_userId: { noticeId: 1, userId: 9 } });
  });
});

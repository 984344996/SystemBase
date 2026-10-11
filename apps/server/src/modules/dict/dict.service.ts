import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { CreateDictDto, CreateDictItemDto, QueryDictDto, UpdateDictDto, UpdateDictItemDto } from './dict.dto';

export interface DictOption {
  label: string;
  value: string;
}

/**
 * 数据字典：下拉选项的统一来源（避免各页面硬编码枚举）。
 * 读多写少 → 进程内缓存（60s），写操作立即失效。
 */
@Injectable()
export class DictService {
  private cache = new Map<string, { options: DictOption[]; expiresAt: number }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  // ---------- 字典类型 ----------
  async list(query: QueryDictDto) {
    return this.prisma.dict.findMany({
      where: query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
        : {},
      orderBy: [{ id: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
  }

  async create(dto: CreateDictDto) {
    const exists = await this.prisma.dict.findUnique({ where: { code: dto.code } });
    if (exists) throw new BadRequestException(`字典编码「${dto.code}」已存在`);
    return withUniqueViolation(() => this.prisma.dict.create({ data: dto }), `字典编码「${dto.code}」已存在`);
  }

  async update(id: number, dto: UpdateDictDto) {
    const dict = await this.prisma.dict.findUnique({ where: { id } });
    if (!dict) throw new NotFoundException('字典不存在');
    const updated = await this.prisma.dict.update({ where: { id }, data: dto });
    this.invalidate(dict.code);
    return updated;
  }

  async remove(id: number) {
    const dict = await this.prisma.dict.findUnique({ where: { id } });
    if (!dict) throw new NotFoundException('字典不存在');
    // 字典项随字典级联删除（schema onDelete: Cascade）
    await this.prisma.dict.delete({ where: { id } });
    this.invalidate(dict.code);
    return { success: true };
  }

  // ---------- 字典项 ----------
  items(dictId: number) {
    return this.prisma.dictItem.findMany({
      where: { dictId },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
  }

  async addItem(dictId: number, dto: CreateDictItemDto) {
    const dict = await this.prisma.dict.findUnique({ where: { id: dictId } });
    if (!dict) throw new NotFoundException('字典不存在');
    const exists = await this.prisma.dictItem.findUnique({
      where: { dictId_value: { dictId, value: dto.value } },
    });
    if (exists) throw new BadRequestException(`该字典下已存在选项值「${dto.value}」`);
    const item = await this.prisma.dictItem.create({ data: { ...dto, dictId } });
    this.invalidate(dict.code);
    return item;
  }

  async updateItem(id: number, dto: UpdateDictItemDto) {
    const item = await this.prisma.dictItem.findUnique({ where: { id }, include: { dict: true } });
    if (!item) throw new NotFoundException('字典项不存在');
    const updated = await this.prisma.dictItem.update({ where: { id }, data: dto });
    this.invalidate(item.dict.code);
    return updated;
  }

  async removeItem(id: number) {
    const item = await this.prisma.dictItem.findUnique({ where: { id }, include: { dict: true } });
    if (!item) throw new NotFoundException('字典项不存在');
    await this.prisma.dictItem.delete({ where: { id } });
    this.invalidate(item.dict.code);
    return { success: true };
  }

  // ---------- 读取（业务代码 / 前端下拉用） ----------

  /** 按字典编码取启用中的选项（带缓存） */
  async options(code: string): Promise<DictOption[]> {
    const cached = this.cache.get(code);
    if (cached && cached.expiresAt > Date.now()) return cached.options;
    const dict = await this.prisma.dict.findUnique({
      where: { code },
      include: {
        items: {
          where: { status: 'ENABLED' },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          select: { label: true, value: true },
        },
      },
    });
    if (!dict) throw new NotFoundException(`字典 ${code} 不存在`);
    this.cache.set(code, { options: dict.items, expiresAt: Date.now() + this.ttlMs });
    return dict.items;
  }

  /** 取 label（用于列表页把 value 转可读文案）；字典或值缺失时返回原值 */
  async labelOf(code: string, value: string): Promise<string> {
    try {
      const options = await this.options(code);
      return options.find((o) => o.value === value)?.label ?? value;
    } catch {
      return value;
    }
  }

  private invalidate(code: string): void {
    this.cache.delete(code);
  }
}
